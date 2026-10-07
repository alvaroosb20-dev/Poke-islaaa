const crypto = require("crypto");
const { cmd } = require("./_db");
const S = require("./_site");

const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
const pinOk = (p) => !!process.env.ADMIN_PIN && crypto.timingSafeEqual(hash(p || ""), hash(process.env.ADMIN_PIN));
const IMG_KEYS = ["banner", "graduadas"];
const fail = (res, c, m) => res.status(c).json({ error: m });

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "Método no permitido");
  res.setHeader("Cache-Control", "no-store");
  const b = req.body || {};
  try {
    if (b.action === "get") return res.status(200).json({ data: (await S.getData()).data });
    if (b.action === "imgs") return res.status(200).json({ imgs: (await S.getData()).imgs });
    if (!String(b.action).startsWith("admin_")) return fail(res, 400, "Acción no válida");
    if (!pinOk(b.pin)) { await new Promise((r) => setTimeout(r, 800)); return fail(res, 401, "PIN incorrecto"); }

    if (b.action === "admin_save") {
      const d = b.data || {}, out = { texts: {}, ship: {}, ig: "", colors: {} };
      const entries = Object.entries(d.texts && typeof d.texts === "object" ? d.texts : {});
      if (entries.length > 1000) return fail(res, 400, "Demasiados textos");
      for (const [k, v] of entries) if (/^p?[a-z0-9]{3,24}$/.test(k) && typeof v === "string" && v.length <= 1000) out.texts[k] = v;
      for (const z of Object.keys(S.ZONES)) { const v = d.ship && d.ship[z]; if (Number.isSafeInteger(v) && v >= 0 && v <= 99999) out.ship[z] = v; }
      if (typeof d.ig === "string" && /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_./?=&-]{1,150}$/.test(d.ig)) out.ig = d.ig;
      for (const k of ["pk", "la", "ab", "lr"]) { const v = d.colors && d.colors[k]; if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out.colors[k] = v; }
      await cmd(["HSET", "site", "data", JSON.stringify(out)]);
      return res.status(200).json({ ok: true, data: out });
    }
    if (b.action === "admin_img") {
      if (!IMG_KEYS.includes(b.key)) return fail(res, 400, "Imagen no válida");
      const cur = (await S.getData()).imgs;
      if (b.img == null) delete cur[b.key];
      else {
        if (typeof b.img !== "string" || !b.img.startsWith("data:image/") || b.img.length > 900000) return fail(res, 400, "Imagen no válida o demasiado grande");
        cur[b.key] = b.img;
      }
      await cmd(["HSET", "site", "imgs", JSON.stringify(cur)]);
      return res.status(200).json({ ok: true });
    }
    return fail(res, 400, "Acción no válida");
  } catch (e) {
    return fail(res, 500, "Error del servidor. Inténtalo de nuevo.");
  }
};
