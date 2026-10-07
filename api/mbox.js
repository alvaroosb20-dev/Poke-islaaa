const crypto = require("crypto");
const { cmd } = require("./_db");
const M = require("./_mbox");
const { shipTable } = require("./_site");

const TOK = /^[a-f0-9]{32}$/;
const fail = (res, c, m) => res.status(c).json({ error: m });
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
const pinOk = (p) => !!process.env.ADMIN_PIN && crypto.timingSafeEqual(hash(p || ""), hash(process.env.ADMIN_PIN));
const getTicket = async (tok) => { if (!TOK.test(String(tok || ""))) return null; const r = await cmd(["HMGET", "tickets", tok]); return r[0] ? M.parse(r[0]) : null; };
const brief = (t) => ({ token: t.token, status: t.status, boxName: t.boxName, price: t.price, created: t.created, ship: t.ship,
  prize: t.prize ? { name: t.prize.name, desc: t.prize.desc, value: t.prize.value, rarity: t.prize.rarity || "Común", img: t.prize.img } : null });

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "Método no permitido");
  res.setHeader("Cache-Control", "no-store");
  const b = req.body || {};
  try {
    if (String(b.action).startsWith("admin_")) {
      if (!pinOk(b.pin)) { await new Promise((r) => setTimeout(r, 800)); return fail(res, 401, "PIN incorrecto"); }
      if (b.action === "admin_list") {
        const tickets = M.list(await cmd(["HGETALL", "tickets"])).sort((x, y) => y.created - x.created).slice(0, 100);
        return res.status(200).json({ boxes: await M.allBoxes(), tickets });
      }
      if (b.action === "admin_save_box") {
        const box = M.validateBox(b.box);
        await cmd(["HSET", "mbox", String(box.id), JSON.stringify(box)]);
        return res.status(200).json({ ok: true, box });
      }
      if (b.action === "admin_del_box") {
        if (!Number.isSafeInteger(b.id)) return fail(res, 400, "Id no válido");
        await cmd(["HDEL", "mbox", String(b.id)]);
        return res.status(200).json({ ok: true });
      }
      if (b.action === "admin_ship") {
        const t = await getTicket(b.token);
        if (!t || !M.SHIP.includes(b.ship)) return fail(res, 400, "Datos no válidos");
        t.ship = b.ship;
        await cmd(["HSET", "tickets", t.token, JSON.stringify(t)]);
        return res.status(200).json({ ok: true });
      }
      return fail(res, 400, "Acción no válida");
    }

    if (b.action === "public") {
      return res.status(200).json({ boxes: (await M.allBoxes()).filter((x) => x.active && M.valid(x)).map(M.pub) });
    }

    if (b.action === "buy") {
      const ENVIOS = await shipTable(), box = await M.getBox(Number(b.boxId)), env = ENVIOS[b.zone];
      if (!box || !box.active || !M.valid(box)) return fail(res, 400, "Esta Mystery Box no está disponible");
      if (!env) return fail(res, 400, "Zona de envío no válida");
      try {
        const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim(), k = "rlb:" + ip + ":" + Math.floor(Date.now() / 3600000);
        if ((await cmd(["INCR", k])) > 20) return fail(res, 429, "Demasiados intentos. Prueba más tarde.");
        await cmd(["EXPIRE", k, 3600]);
      } catch (_) {}
      const f = new URLSearchParams(), base = "https://" + req.headers.host;
      f.append("mode", "payment");
      f.append("line_items[0][quantity]", "1");
      f.append("line_items[0][price_data][currency]", "eur");
      f.append("line_items[0][price_data][unit_amount]", box.price);
      f.append("line_items[0][price_data][product_data][name]", "Mystery Box · " + box.name);
      f.append("shipping_address_collection[allowed_countries][0]", "ES");
      f.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      f.append("shipping_options[0][shipping_rate_data][display_name]", "Envío del premio " + env[0]);
      f.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", env[1]);
      f.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "eur");
      f.append("phone_number_collection[enabled]", "true");
      f.append("metadata[kind]", "mbox");
      f.append("metadata[boxId]", String(box.id));
      f.append("metadata[zone]", b.zone);
      f.append("success_url", base + "/?caja={CHECKOUT_SESSION_ID}");
      f.append("cancel_url", base + "/#mystery");
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST",
        headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body: f });
      const d = await r.json();
      if (!r.ok) return fail(res, 500, (d.error && d.error.message) || "Error de Stripe");
      return res.status(200).json({ url: d.url });
    }

    if (b.action === "claim") {
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(String(b.session || ""))) return fail(res, 400, "Sesión no válida");
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + b.session, { headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY } });
      const s = await r.json();
      if (!r.ok || s.payment_status !== "paid" || !s.metadata || s.metadata.kind !== "mbox") return fail(res, 402, "No encontramos un pago válido de Mystery Box");
      return res.status(200).json({ token: await M.ensureTicket(s) });
    }

    if (b.action === "ticket") {
      const t = await getTicket(b.token);
      if (!t) return fail(res, 404, "Ticket no encontrado");
      const box = await M.getBox(t.boxId);
      return res.status(200).json({ ticket: brief(t), box: box ? M.pub(box) : null });
    }

    if (b.action === "spin") {
      let t = await getTicket(b.token);
      if (!t) return fail(res, 404, "Ticket no encontrado");
      if (t.status === "spun") return res.status(200).json({ prize: t.prize, already: true });
      if ((await cmd(["SET", "spin:" + t.token, "1", "NX", "EX", "30"])) !== "OK") return fail(res, 409, "La ruleta ya está girando");
      t = await getTicket(t.token);
      if (t.status === "spun") return res.status(200).json({ prize: t.prize, already: true });
      const box = await M.getBox(t.boxId);
      if (!box || !M.valid(box)) return fail(res, 409, "Esta caja no está disponible ahora. Escríbenos por Instagram @poke_islas.");
      const z = M.pick(box);
      t.status = "spun"; t.spunAt = Date.now();
      t.prize = { id: z.id, name: z.name, desc: z.desc, value: z.value, rarity: z.rarity || "Común", img: z.img || null, p: z.p };
      await cmd(["HSET", "tickets", t.token, JSON.stringify(t)]);
      try { await cmd(["LPUSH", "mb:log", JSON.stringify({ at: t.spunAt, ticket: t.token, box: t.boxId, prize: z.id, name: z.name, value: z.value })]); } catch (_) {}
      return res.status(200).json({ prize: t.prize });
    }

    if (b.action === "mine") {
      const toks = (Array.isArray(b.tokens) ? b.tokens : []).filter((x) => TOK.test(String(x))).slice(0, 50);
      if (!toks.length) return res.status(200).json({ items: [] });
      const rows = await cmd(["HMGET", "tickets", ...toks]);
      return res.status(200).json({ items: rows.filter(Boolean).map(M.parse).filter(Boolean).sort((x, y) => y.created - x.created).map(brief) });
    }
    return fail(res, 400, "Acción no válida");
  } catch (e) {
    const val = e.message && /Texto|Imagen|Valor|Probab|precio|Máximo|probabilidades|Datos/.test(e.message);
    return fail(res, val ? 400 : 500, val ? e.message : "Error del servidor. Inténtalo de nuevo.");
  }
};
