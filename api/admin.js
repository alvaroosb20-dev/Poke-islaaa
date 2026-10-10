// Administración de productos de la tienda (requiere PIN) y diagnóstico del sistema.
const { gemini } = require("./_gemini");
const { cmd, parse, getAll } = require("./_db");
const { putImg, delImg, checkImg } = require("./_img");
const { checkPin } = require("./_auth");
const CP = require("./_coupons");

const int = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const txt = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  res.setHeader("Cache-Control", "no-store");
  const { pin, action, product, id, ids } = req.body || {};
  const bad = await checkPin(req, pin).catch((e) => ({ code: 500, error: e.message }));
  if (bad) return res.status(bad.code).json({ error: bad.error });
  try {
    if (action === "check") return res.status(200).json({ ok: true });

    if (action === "status") {
      const env = (k) => !!process.env[k];
      const out = {
        db: false, dbError: "",
        vars: {
          "Base de datos (KV_REST_API_URL)": env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL"),
          "Stripe (STRIPE_SECRET_KEY)": env("STRIPE_SECRET_KEY"),
          "Webhook de Stripe (STRIPE_WEBHOOK_SECRET)": env("STRIPE_WEBHOOK_SECRET"),
          "Correos (RESEND_API_KEY)": env("RESEND_API_KEY"),
          "Asistente (GEMINI_API_KEY)": env("GEMINI_API_KEY"),
          "PIN de administrador (ADMIN_PIN)": env("ADMIN_PIN"),
        },
        stripeMode: (process.env.STRIPE_SECRET_KEY || "").includes("_live_") ? "real" : (process.env.STRIPE_SECRET_KEY ? "prueba" : ""),
        counts: {},
      };
      try {
        const v = String(Date.now());
        await cmd(["SET", "diag", v, "EX", "60"]);
        out.db = (await cmd(["GET", "diag"])) === v;
        const all = ((await cmd(["HGETALL", "products"])) || []).filter((_, i) => i % 2).map(parse).filter(Boolean);
        out.fotos = { guardadas: all.filter((p) => p.iv).length, antiguas: all.filter((p) => !p.iv && typeof p.img === "string" && p.img.startsWith("data:")).length, deEjemplo: all.filter((p) => !p.iv && !p.img && p.i).length, sinFoto: all.filter((p) => !p.iv && !p.img && !p.i).length };
        out.counts = { productos: Number(await cmd(["HLEN", "products"])) || 0, cajas: Number(await cmd(["HLEN", "mbox"])) || 0, compras: Number(await cmd(["HLEN", "purchases"])) || 0, giros: Number(await cmd(["LLEN", "mb:log"])) || 0 };
      } catch (e) { out.dbError = e.message; }
      if (process.env.GEMINI_API_KEY) {
        try { const g = await gemini("Responde solo con la palabra OK.", [{ role: "user", parts: [{ text: "Hola" }] }], { max: 1024, budget: 30000 }); out.ai = { ok: true, model: g.model }; }
        catch (e) { out.ai = { ok: false, code: e.code, msg: String(e.message || "").slice(0, 200) }; }
      }
      return res.status(200).json(out);
    }

    if (action === "delete") {
      if (!Number.isSafeInteger(id)) return res.status(400).json({ error: "Producto no válido" });
      await cmd(["HDEL", "products", String(id)]);
      await delImg("p" + id);
      const still = (await cmd(["HMGET", "products", String(id)]))[0];
      if (still) return res.status(500).json({ error: "No se pudo eliminar el producto" });
      return res.status(200).json({ ok: true });
    }

    if (action === "save") {
      const p = product || {};
      if (!Number.isSafeInteger(p.id) || p.id < 1) return res.status(400).json({ error: "Producto no válido" });
      const n = txt(p.n, 120);
      if (!n) return res.status(400).json({ error: "Falta el nombre del producto" });
      if (!int(p.pr, 100000000)) return res.status(400).json({ error: "Precio no válido" });
      if (p.o != null && !int(p.o, 100000000)) return res.status(400).json({ error: "Precio anterior no válido" });
      if (!int(p.s, 1000000)) return res.status(400).json({ error: "Stock no válido" });
      if (p.link && !/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_-]+$/.test(String(p.link))) return res.status(400).json({ error: "El enlace de pago debe empezar por https://buy.stripe.com/" });
      const newImg = typeof p.img === "string" && p.img.startsWith("data:image/") ? p.img : null; // una URL o null = foto sin cambios
      if (newImg) checkImg(newImg);

      const prev = parse((await cmd(["HMGET", "products", String(p.id)]))[0]) || {};
      const row = {
        id: p.id, n, c: txt(p.c, 60) || "Cartas sueltas", g: txt(p.g, 40) || null, pr: p.pr, o: p.o || null, s: p.s, f: p.f ? 1 : 0,
        i: /^[a-z0-9]{1,10}$/.test(String(p.i || "")) ? p.i : null, link: p.link || null,
        h: /^#[0-9a-f]{6}$/i.test(String(p.h || "")) ? p.h : "#1f7a5c", d: txt(p.d, 1000) || null,
        iv: prev.iv || null, ord: Number.isFinite(prev.ord) ? prev.ord : null,
      };
      if (newImg) row.iv = await putImg("p" + p.id, newImg);
      else if (p.rmImg) { await delImg("p" + p.id); row.iv = null; row.i = null; }
      else if (!row.iv && typeof prev.img === "string" && prev.img.startsWith("data:image/")) {
        try { row.iv = await putImg("p" + p.id, prev.img); } catch (_) { row.img = prev.img; } // conserva la foto antigua
      }
      Object.keys(row).forEach((k) => (row[k] === null || row[k] === "") && delete row[k]);
      await cmd(["HSET", "products", String(row.id), JSON.stringify(row)]);
      // Se relee de la base de datos para confirmar que se ha guardado
      const saved = parse((await cmd(["HMGET", "products", String(row.id)]))[0]);
      if (!saved || saved.pr !== row.pr || saved.n !== row.n) return res.status(500).json({ error: "La base de datos no confirmó el guardado" });
      return res.status(200).json({ ok: true, product: saved });
    }

    if (action === "order") {
      if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(Number.isSafeInteger)) return res.status(400).json({ error: "Orden no válido" });
      const rows = await cmd(["HMGET", "products", ...ids.map(String)]);
      const args = [];
      rows.forEach((r, i) => { const p = parse(r); if (!p) return; p.ord = i; args.push(String(ids[i]), JSON.stringify(p)); });
      if (args.length) await cmd(["HSET", "products", ...args]);
      return res.status(200).json({ ok: true, products: await getAll() });
    }

    if (action === "mail_test") {
      const to = String(req.body.to || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: "Escribe un email válido" });
      const { sendMail, wrap } = require("./_mail");
      try { await sendMail(to, "Prueba de correo de Poke Islas", wrap("<p>Si te llega este correo, los emails de la web funcionan bien ✅</p>")); return res.status(200).json({ ok: true, from: process.env.EMAIL_FROM || "Poke Islas <pedidos@poke-isla.com>" }); }
      catch (e) { return res.status(200).json({ ok: false, error: e.message, from: process.env.EMAIL_FROM || "Poke Islas <pedidos@poke-isla.com>" }); }
    }
    if (action === "coupons") return res.status(200).json({ items: await CP.listCoupons() });
    if (action === "coupon_save") {
      let c;
      try { c = CP.cleanCoupon(req.body.coupon || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
      const prev = await CP.getCoupon(c.code);
      c.created = prev && prev.created ? prev.created : Date.now();
      await cmd(["HSET", "coupons", c.code, JSON.stringify(c)]);
      return res.status(200).json({ ok: true, items: await CP.listCoupons() });
    }
    if (action === "coupon_del") {
      const code = CP.norm(req.body.code);
      await cmd(["HDEL", "coupons", code]);
      return res.status(200).json({ ok: true, items: await CP.listCoupons() });
    }
    if (action === "sales") {
      const raw = (await cmd(["LRANGE", "ventas", "0", "199"])) || [];
      return res.status(200).json({ items: raw.map(parse).filter(Boolean) });
    }

    res.status(400).json({ error: "Acción no válida" });
  } catch (e) {
    const user = /^Imagen/.test(e.message || "");
    res.status(user ? 400 : 500).json({ error: user ? e.message : "Error del servidor: " + e.message });
  }
};
