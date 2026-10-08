const crypto = require("crypto");
const { cmd, parse } = require("./_db");
const M = require("./_mbox");
const { shipTable } = require("./_site");
const { checkPin, ipOf } = require("./_auth");
const { stripe, SESSION, customer } = require("./_stripe");
const { getPurchase, setPurchase, listPurchases } = require("./_orders");

const fail = (res, c, m, extra) => res.status(c).json({ error: m, ...(extra || {}) });
const TOK = /^[a-f0-9]{32}$/;
const brief = (t) => ({
  token: t.token, status: t.status, boxName: t.boxName, price: t.price, created: t.created, ship: t.ship,
  spinId: t.spin ? t.spin.id : null, spunAt: t.spunAt || null,
  prize: t.prize ? { id: t.prize.id, name: t.prize.name, desc: t.prize.desc, value: t.prize.value, rarity: t.prize.rarity || "Común", img: t.prize.img } : null,
});

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") { // consulta pública de solo lectura (cajas a la venta)
    try {
      const all = await M.allBoxesRaw(), boxes = [];
      for (const x of all) { const s = await M.withStock(x); if (M.sellable(s)) boxes.push(M.pub(s)); }
      return res.status(200).json({ boxes, creadas: all.length, aLaVenta: boxes.length });
    } catch (e) { return fail(res, 500, "Error del servidor: " + e.message); }
  }
  if (req.method !== "POST") return fail(res, 405, "Método no permitido");
  const b = req.body || {};
  try {
    // ---------- Administración (requiere PIN) ----------
    if (String(b.action).startsWith("admin_")) {
      const bad = await checkPin(req, b.pin);
      if (bad) return fail(res, bad.code, bad.error);

      if (b.action === "admin_list") {
        const boxes = [];
        for (const x of await M.allBoxesRaw()) boxes.push(M.adm(await M.withStock(x)));
        return res.status(200).json({ boxes });
      }
      if (b.action === "admin_box") {
        const box = await M.withStock(await M.getBox(Number(b.id)));
        if (!box) return fail(res, 404, "Caja no encontrada");
        return res.status(200).json({ box: M.adm(box) });
      }
      if (b.action === "admin_save_box") {
        const saved = await M.saveBox(b.box);
        const box = await M.withStock(await M.getBox(saved.id)); // se relee de la base de datos para confirmar
        return res.status(200).json({ ok: true, box: M.adm(box) });
      }
      if (b.action === "admin_del_box") {
        if (!Number.isSafeInteger(b.id)) return fail(res, 400, "Id no válido");
        await M.deleteBox(b.id);
        if (await M.getBox(b.id)) return fail(res, 500, "No se pudo eliminar la caja");
        return res.status(200).json({ ok: true });
      }
      if (b.action === "admin_orders") {
        const tickets = (await cmd(["HGETALL", "tickets"])) || [];
        const tk = [];
        if (Array.isArray(tickets)) for (let i = 0; i < tickets.length; i += 2) { const o = parse(tickets[i + 1]); if (o) tk.push(o); }
        else for (const v of Object.values(tickets)) { const o = parse(v); if (o) tk.push(o); }
        tk.sort((x, y) => y.created - x.created);
        const log = ((await cmd(["LRANGE", "mb:log", "0", "499"])) || []).map(parse).filter(Boolean);
        return res.status(200).json({ purchases: await listPurchases(300), tickets: tk.slice(0, 300), log });
      }
      if (b.action === "admin_ship") {
        const t = await M.getTicket(b.token);
        if (!t || !M.SHIP.includes(b.ship)) return fail(res, 400, "Datos no válidos");
        t.ship = b.ship;
        await cmd(["HSET", "tickets", t.token, JSON.stringify(t)]);
        return res.status(200).json({ ok: true, ship: t.ship });
      }
      return fail(res, 400, "Acción no válida");
    }

    // ---------- Público ----------
    if (b.action === "public") {
      const boxes = [];
      for (const x of await M.allBoxesRaw()) { const s = await M.withStock(x); if (M.sellable(s)) boxes.push(M.pub(s)); }
      return res.status(200).json({ boxes });
    }

    if (b.action === "buy") {
      const box = await M.withStock(await M.getBox(Number(b.boxId)));
      if (!M.sellable(box)) return fail(res, 409, "Esta Mystery Box no está disponible ahora mismo");
      const ENVIOS = await shipTable(), env = ENVIOS[b.zone];
      if (!env) return fail(res, 400, "Elige una zona de envío válida");
      try {
        const k = "rlb:" + ipOf(req) + ":" + Math.floor(Date.now() / 3600000);
        if ((await cmd(["INCR", k])) > 60) return fail(res, 429, "Demasiados intentos de compra seguidos. Prueba dentro de un rato.");
        await cmd(["EXPIRE", k, 3600]);
      } catch (_) {}
      const base = "https://" + req.headers.host;
      const f = new URLSearchParams();
      f.append("mode", "payment");
      f.append("line_items[0][quantity]", "1");
      f.append("line_items[0][price_data][currency]", "eur");
      f.append("line_items[0][price_data][unit_amount]", String(box.price)); // el precio sale de la base de datos, nunca del navegador
      f.append("line_items[0][price_data][product_data][name]", "Mystery Box · " + box.name);
      f.append("shipping_address_collection[allowed_countries][0]", "ES");
      f.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      f.append("shipping_options[0][shipping_rate_data][display_name]", "Envío del premio " + env[0]);
      f.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(env[1]));
      f.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "eur");
      f.append("phone_number_collection[enabled]", "true");
      f.append("metadata[kind]", "mbox");
      f.append("metadata[boxId]", String(box.id));
      f.append("metadata[zone]", b.zone);
      f.append("payment_intent_data[metadata][kind]", "mbox");
      f.append("success_url", base + "/?caja={CHECKOUT_SESSION_ID}#mystery");
      f.append("cancel_url", base + "/?cancelado={CHECKOUT_SESSION_ID}#mystery");
      // Si el mismo clic llega dos veces, Stripe devuelve la misma sesión (no se duplica la compra)
      const nonce = /^[a-z0-9]{8,40}$/i.test(String(b.nonce || "")) ? b.nonce : crypto.randomBytes(8).toString("hex");
      const s = await stripe("POST", "checkout/sessions", f, "mbox_" + box.id + "_" + nonce);
      await setPurchase(s.id, { kind: "mbox", boxId: box.id, boxName: box.name, price: box.price, ship: env[1], zone: b.zone, status: "pendiente" }, "compra");
      return res.status(200).json({ url: s.url });
    }

    if (b.action === "claim") {
      if (!SESSION.test(String(b.session || ""))) return fail(res, 400, "Enlace de pago no válido");
      const s = await stripe("GET", "checkout/sessions/" + b.session);
      if (!s.metadata || s.metadata.kind !== "mbox") return fail(res, 400, "Este pago no corresponde a una Mystery Box");
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || "";
      if (s.payment_status === "paid") {
        await setPurchase(s.id, { kind: "mbox", boxId: Number(s.metadata.boxId), status: "pagado", pi, paid: s.amount_total, ...customer(s) }, "verificación");
        return res.status(200).json({ token: await M.ensureTicket(s) });
      }
      if (s.status === "expired") {
        await setPurchase(s.id, { status: "cancelado" }, "verificación");
        return fail(res, 410, "Este pago se canceló o caducó. No se ha cobrado nada.");
      }
      if (s.status === "complete") {
        await setPurchase(s.id, { status: "pago_pendiente", pi }, "verificación");
        return res.status(202).json({ pending: true, msg: "Tu pago se está procesando. Cuando el banco lo confirme podrás girar la ruleta (también te llegará por correo)." });
      }
      return res.status(202).json({ pending: true, msg: "Todavía no hemos recibido el pago." });
    }

    if (b.action === "ticket") {
      const t = await M.getTicket(b.token);
      if (!t) return fail(res, 404, "No encontramos esta compra");
      const box = await M.withStock(await M.getBox(t.boxId));
      return res.status(200).json({ ticket: brief(t), box: box ? M.pub(box) : null });
    }

    if (b.action === "spin") {
      let t = await M.getTicket(b.token);
      if (!t) return fail(res, 404, "No encontramos un pago válido para girar");
      if (t.status === "spun") return res.status(200).json({ prize: t.prize, spinId: t.spin && t.spin.id, already: true });
      const pur = t.session ? await getPurchase(t.session) : null;
      if (pur && pur.status === "reembolsado") return fail(res, 409, "Este pago fue reembolsado y ya no da derecho a girar");
      if ((await cmd(["SET", "spin:" + t.token, "1", "NX", "EX", "30"])) !== "OK") return fail(res, 409, "Tu giro ya se está procesando");
      t = await M.getTicket(t.token);
      if (t.status === "spun") return res.status(200).json({ prize: t.prize, spinId: t.spin && t.spin.id, already: true });
      let d;
      try { d = await M.draw(t.boxId); }
      catch (e) { await cmd(["DEL", "spin:" + t.token]).catch(() => {}); return fail(res, 409, e.message + ". Tu pago sigue guardado: escríbenos por Instagram @poke_islas."); }
      const { box, prize, rnd, total, candidates } = d;
      const at = Date.now();
      const spin = { id: "g_" + crypto.randomBytes(6).toString("hex"), at, rnd, total, candidates, prizeId: prize.id, boxUpdated: box.updated || null };
      t.status = "spun"; t.spunAt = at; t.spin = spin;
      t.prize = { id: prize.id, name: prize.name, desc: prize.desc, value: prize.value, rarity: prize.rarity || "Común", img: M.pub(box).prizes.find((x) => x.id === prize.id)?.img || null, p: prize.p };
      try { await cmd(["HSET", "tickets", t.token, JSON.stringify(t)]); }
      catch (e) { await M.restock(box.id, prize); await cmd(["DEL", "spin:" + t.token]).catch(() => {}); throw e; }
      await cmd(["LPUSH", "mb:log", JSON.stringify({ spinId: spin.id, at, ticket: t.token, session: t.session, pi: t.pi || "", email: t.email, name: t.name,
        boxId: t.boxId, boxName: t.boxName, price: t.price, payment: pur ? pur.status : "pagado", prizeId: prize.id, prize: prize.name, value: prize.value,
        rnd, total, candidates })]).catch(() => {});
      await cmd(["LTRIM", "mb:log", "0", "4999"]).catch(() => {});
      return res.status(200).json({ prize: t.prize, spinId: spin.id });
    }

    if (b.action === "mine") {
      const toks = (Array.isArray(b.tokens) ? b.tokens : []).filter((x) => TOK.test(String(x))).slice(0, 50);
      if (!toks.length) return res.status(200).json({ items: [] });
      const rows = await cmd(["HMGET", "tickets", ...toks]);
      return res.status(200).json({ items: (rows || []).filter(Boolean).map(parse).filter(Boolean).sort((x, y) => y.created - x.created).map(brief) });
    }
    return fail(res, 400, "Acción no válida");
  } catch (e) {
    const msg = String(e.message || "");
    const user = e.stripe || /^(Falta|El precio|Precio|Máximo|Valor|Probabilidad|Usa como|Stock|Imagen|Las probabilidades|Datos|Esta caja|Todos los premios|Hay mucha)/.test(msg) || / demasiado largo/.test(msg);
    return fail(res, user ? 400 : 500, user ? msg : "Error del servidor. Inténtalo de nuevo.");
  }
};
