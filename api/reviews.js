// Reseñas de clientes: estrellas, comentario y foto. Se publican al momento; el administrador puede ocultarlas o borrarlas.
const crypto = require("crypto");
const { cmd, parse, hvals } = require("./_db");
const { putImg, delImg, imgUrl, checkImg } = require("./_img");
const { checkPin, ipOf } = require("./_auth");

const fail = (res, c, m) => res.status(c).json({ error: m });
const txt = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const pub = (r) => ({ id: r.id, name: r.name, stars: r.stars, text: r.text, at: r.at, verified: !!r.verified, img: r.iv ? imgUrl("r" + r.id, r.iv) : null, reply: r.reply || "" });
const all = async () => hvals(await cmd(["HGETALL", "reviews"])).sort((a, b) => b.at - a.at);

async function publicList() {
  const list = (await all()).filter((r) => r.ok);
  const n = list.length, avg = n ? Math.round((list.reduce((s, r) => s + r.stars, 0) / n) * 10) / 10 : 0;
  return { avg, count: n, items: list.slice(0, 200).map(pub) };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") return res.status(200).json(await publicList());
    if (req.method !== "POST") return fail(res, 405, "Método no permitido");
    const b = req.body || {};

    if (b.action === "add") {
      const name = txt(b.name, 40), text = txt(b.text, 600), stars = Number(b.stars);
      if (!name) return fail(res, 400, "Escribe tu nombre");
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) return fail(res, 400, "Elige de 1 a 5 estrellas");
      if (text.length < 3) return fail(res, 400, "Escribe un comentario");
      if (b.img != null && b.img !== "") checkImg(b.img);
      const k = "rvl:" + ipOf(req) + ":" + new Date().toISOString().slice(0, 10);
      const n = Number(await cmd(["INCR", k]));
      if (n === 1) await cmd(["EXPIRE", k, "90000"]);
      if (n > 3) return fail(res, 429, "Has enviado varias reseñas hoy. Inténtalo mañana.");
      // Compra verificada: el email coincide con una compra pagada (el email no se guarda)
      let verified = false;
      const email = txt(b.email, 120).toLowerCase();
      if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        const ps = hvals(await cmd(["HGETALL", "purchases"]));
        verified = ps.some((p) => p.status === "pagado" && String(p.email || "").toLowerCase() === email);
      }
      const id = String(Date.now()) + crypto.randomInt(100, 999);
      const r = { id, name, stars, text, at: Date.now(), ok: 1, verified, iv: null };
      if (b.img) r.iv = await putImg("r" + id, b.img);
      await cmd(["HSET", "reviews", id, JSON.stringify(r)]);
      return res.status(200).json({ ok: true, review: pub(r) });
    }

    if (String(b.action).startsWith("admin_")) {
      const bad = await checkPin(req, b.pin);
      if (bad) return fail(res, bad.code, bad.error);
      if (b.action === "admin_list") return res.status(200).json({ items: (await all()).map((r) => ({ ...pub(r), ok: !!r.ok })) });
      const id = String(b.id || "");
      if (!/^\d{10,20}$/.test(id)) return fail(res, 400, "Reseña no válida");
      const r = parse((await cmd(["HMGET", "reviews", id]))[0]);
      if (!r) return fail(res, 404, "Reseña no encontrada");
      if (b.action === "admin_ok") {
        r.ok = b.ok ? 1 : 0;
        if (typeof b.reply === "string") r.reply = txt(b.reply, 400);
        await cmd(["HSET", "reviews", id, JSON.stringify(r)]);
        return res.status(200).json({ ok: true, review: { ...pub(r), ok: !!r.ok } });
      }
      if (b.action === "admin_del") {
        await cmd(["HDEL", "reviews", id]);
        if (r.iv) await delImg("r" + id);
        return res.status(200).json({ ok: true });
      }
    }
    return fail(res, 400, "Acción no válida");
  } catch (e) {
    const user = /^Imagen/.test(e.message || "");
    return fail(res, user ? 400 : 500, user ? e.message : "Error del servidor. Inténtalo de nuevo.");
  }
};
