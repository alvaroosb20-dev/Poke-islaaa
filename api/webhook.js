// Avisos de Stripe: confirman pagos, fallos, cancelaciones y reembolsos.
const crypto = require("crypto");
const { cmd, parse } = require("./_db");
const { ensureTicket } = require("./_mbox");
const { stripe, customer } = require("./_stripe");
const { setPurchase } = require("./_orders");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (c) => (Number(c || 0) / 100).toFixed(2).replace(".", ",") + " €";

async function rawBody(req) {
  const parts = [];
  for await (const c of req) parts.push(Buffer.from(c));
  if (parts.length) return Buffer.concat(parts);
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  return Buffer.alloc(0);
}

function firmaValida(body, header, secret) {
  let t = null;
  const v1 = [];
  for (const p of String(header || "").split(",")) {
    const i = p.indexOf("=");
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (k === "t") t = v;
    if (k === "v1") v1.push(v);
  }
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const esperado = crypto.createHmac("sha256", secret).update(t + "." + body.toString("utf8")).digest("hex");
  return v1.some((v) => v.length === esperado.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(esperado)));
}

async function enviar(to, subject, html, replyTo) {
  if (!process.env.RESEND_API_KEY) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "Poke Islas <pedidos@poke-isla.com>", to: [to], reply_to: replyTo, subject, html }),
  });
  if (!r.ok) throw new Error("Resend " + r.status);
}

// Descuenta el stock de la tienda con un bloqueo por producto
async function descontar(items) {
  for (const [id, qty] of items) {
    if (!Number.isSafeInteger(id) || !(qty > 0)) continue;
    const lk = "lock:prod:" + id;
    for (let i = 0; i < 30 && (await cmd(["SET", lk, "1", "NX", "EX", "10"])) !== "OK"; i++) await new Promise((r) => setTimeout(r, 100));
    try {
      const p = parse((await cmd(["HMGET", "products", String(id)]))[0]);
      if (!p) continue;
      p.s = Math.max(0, (p.s || 0) - qty);
      await cmd(["HSET", "products", String(id), JSON.stringify(p)]);
    } finally { await cmd(["DEL", lk]).catch(() => {}); }
  }
}

async function pagado(s) {
  const kind = (s.metadata && s.metadata.kind) || "tienda";
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || "";
  const c = customer(s);
  await setPurchase(s.id, { kind, status: "pagado", pi, paid: s.amount_total, ...c }, "webhook");
  const tok = kind === "mbox" ? await ensureTicket(s) : null; // idempotente: un ticket por pago
  // Stock y correos solo una vez por pago aunque Stripe repita el aviso
  if ((await cmd(["SET", "done:" + s.id, "1", "NX"])) !== "OK") return;
  const cpc = s.metadata && s.metadata.coupon;
  if (cpc && /^[A-Z0-9_-]{3,24}$/.test(cpc)) await cmd(["HINCRBY", "cpuse", cpc, "1"]).catch(() => {});

  let extra = "";
  if (kind === "mbox") {
    const link = (process.env.SITE_URL || "https://poke-isla.com") + "/?caja=" + tok + "#mystery";
    extra = `<p style="background:#fff8d6;padding:14px;border-radius:10px"><b>🎁 Tu PokeRuleta está lista.</b><br>Gira la ruleta aquí: <a href="${link}">${link}</a><br><small>Guarda este enlace: solo se puede girar una vez.</small></p>`;
  } else {
    const items = String((s.metadata && s.metadata.items) || "").split(",").filter(Boolean).map((x) => x.split(":").map(Number));
    try { await descontar(items); } catch (e) { console.error("stock", e.message); }
  }

  try {
    let lineas = [];
    try { lineas = ((await stripe("GET", "checkout/sessions/" + s.id + "/line_items?limit=50")).data || []).map((l) => ({ n: l.description, q: l.quantity, t: l.amount_total })); } catch (_) {}
    const envio = s.shipping_cost && s.shipping_cost.amount_total;
    const filas = lineas.map((l) => `<tr><td style="padding:6px 0">${esc(l.n)} × ${esc(l.q)}</td><td style="padding:6px 0;text-align:right">${eur(l.t)}</td></tr>`).join("");
    const tabla = `<table style="width:100%;border-collapse:collapse">${filas}<tr><td style="padding:6px 0">Envío</td><td style="text-align:right">${eur(envio)}</td></tr><tr><td style="padding:8px 0;border-top:2px solid #0c1a1e"><b>Total</b></td><td style="text-align:right;border-top:2px solid #0c1a1e"><b>${eur(s.amount_total)}</b></td></tr></table>`;
    const nombre = esc((c.name || "").split(" ")[0] || "coleccionista");
    if (c.email) {
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0c1a1e"><h1 style="margin:0 0 4px">POKE <span style="color:#e0a800">ISLAS</span></h1><p style="margin:0 0 20px;color:#555">Pokémon Grade · Canarias · España</p><h2>¡Gracias por tu compra, ${nombre}!</h2><p>Hemos recibido tu pedido y tu pago. Ya estamos preparándolo y te avisaremos cuando salga el envío.</p>${extra}${tabla}<p style="margin-top:18px"><b>Dirección de envío:</b><br>${esc(c.address) || "-"}</p><p>Si tienes cualquier duda, responde a este correo o escríbenos por Instagram <a href="https://www.instagram.com/poke_islas/">@poke_islas</a>.</p></div>`;
      await enviar(c.email, "Gracias por tu compra en Poke Islas", html, process.env.VENTAS_EMAIL || "pokeislatcg@gmail.com");
    }
    const aviso = `<h2>Nueva venta${kind === "mbox" ? " · PokeRuleta" : ""}</h2><p><b>Cliente:</b> ${esc(c.name)} · ${esc(c.email)} · ${esc(c.phone)}</p><p><b>Zona de envío:</b> ${esc(s.metadata && s.metadata.zone)}</p><p><b>Dirección:</b> ${esc(c.address) || "-"}</p><p><b>Pago Stripe:</b> ${esc(pi)}</p>${tabla}`;
    await enviar(process.env.VENTAS_EMAIL || "pokeislatcg@gmail.com", "Nueva venta: " + eur(s.amount_total) + " - " + (c.name || c.email || ""), aviso, c.email);
  } catch (e) { console.error("correo", e.message); }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Método no permitido");
  const body = await rawBody(req);
  if (!process.env.STRIPE_WEBHOOK_SECRET || !firmaValida(body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET))
    return res.status(400).send("Firma no válida");
  let ev;
  try { ev = JSON.parse(body.toString("utf8")); } catch (_) { return res.status(400).send("JSON no válido"); }
  const o = ev.data && ev.data.object;
  try {
    switch (ev.type) {
      case "checkout.session.completed":
        if (o.payment_status === "paid" || o.payment_status === "no_payment_required") await pagado(o);
        else await setPurchase(o.id, { kind: (o.metadata && o.metadata.kind) || "tienda", status: "pago_pendiente", ...customer(o) }, "webhook");
        break;
      case "checkout.session.async_payment_succeeded":
        await pagado(o);
        break;
      case "checkout.session.async_payment_failed":
        await setPurchase(o.id, { status: "fallido" }, "webhook");
        break;
      case "checkout.session.expired":
        await setPurchase(o.id, { status: "cancelado" }, "webhook");
        break;
      case "charge.refunded": {
        const pi = typeof o.payment_intent === "string" ? o.payment_intent : "";
        const sid = pi ? await cmd(["GET", "pi:" + pi]) : null;
        if (sid && o.refunded) await setPurchase(sid, { status: "reembolsado" }, "webhook");
        break;
      }
    }
  } catch (e) {
    console.error("webhook", ev.type, e.message);
    return res.status(500).json({ error: "Error procesando el aviso" }); // Stripe lo reintentará
  }
  res.status(200).json({ ok: true });
};

module.exports.config = { api: { bodyParser: false } };
