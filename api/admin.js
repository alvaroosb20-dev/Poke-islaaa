const { cmd } = require("./_db");
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const { pin, action, product, id } = req.body || {};
  if (!process.env.ADMIN_PIN || typeof pin !== "string" || pin !== process.env.ADMIN_PIN) {
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: "PIN incorrecto" });
  }
  try {
    if (action === "check") return res.status(200).json({ ok: true });
    if (action === "delete") {
      if (!Number.isSafeInteger(id)) return res.status(400).json({ error: "Id no válido" });
      await cmd(["HDEL", "products", String(id)]);
      return res.status(200).json({ ok: true });
    }
    if (action === "save") {
      const p = product || {};
      const int = (v) => Number.isSafeInteger(v) && v >= 0;
      if (!Number.isSafeInteger(p.id) || typeof p.n !== "string" || !p.n.trim() || p.n.length > 120 || !int(p.pr) || !int(p.s))
        return res.status(400).json({ error: "Datos no válidos" });
      if (p.o != null && !int(p.o)) return res.status(400).json({ error: "Precio anterior no válido" });
      if (p.link && !String(p.link).startsWith("https://buy.stripe.com/")) return res.status(400).json({ error: "Enlace de Stripe no válido" });
      if (p.img && (!String(p.img).startsWith("data:image/") || p.img.length > 400000)) return res.status(400).json({ error: "Imagen no válida o demasiado grande" });
      const row = { id: p.id, n: p.n.trim(), c: p.c || null, g: p.g || null, pr: p.pr, o: p.o || null, s: p.s, f: p.f ? 1 : 0, i: p.i || null, img: p.img || null, link: p.link || null, h: p.h || null };
      Object.keys(row).forEach((k) => row[k] === null && delete row[k]);
      await cmd(["HSET", "products", String(row.id), JSON.stringify(row)]);
      return res.status(200).json({ ok: true });
    }
    res.status(400).json({ error: "Acción no válida" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
