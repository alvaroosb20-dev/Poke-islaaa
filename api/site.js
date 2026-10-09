// Textos, fotos, envíos, Instagram y colores de la web (editor del modo administrador).
const { cmd } = require("./_db");
const S = require("./_site");
const { putImg, delImg, imgUrl } = require("./_img");
const { checkPin } = require("./_auth");

const IMG_KEYS = ["banner", "graduadas"];
const fail = (res, c, m) => res.status(c).json({ error: m });

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "Método no permitido");
  res.setHeader("Cache-Control", "no-store");
  const b = req.body || {};
  try {
    if (b.action === "get") {
      // Migración: fotos guardadas por la versión anterior dentro del campo "imgs"
      const old = (await cmd(["HMGET", "site", "imgs"]))[0];
      if (old) {
        const cur = (await S.getData()).data, o = JSON.parse(old);
        cur.iv = cur.iv || {};
        for (const k of IMG_KEYS) if (o[k]) { try { cur.iv[k] = await putImg("s_" + k, o[k]); } catch (_) {} }
        await cmd(["HSET", "site", "data", JSON.stringify(cur)]);
        await cmd(["HDEL", "site", "imgs"]);
      }
      const d = (await S.getData()).data;
      const imgs = {};
      for (const k of IMG_KEYS) if (d.iv && d.iv[k]) imgs[k] = imgUrl("s_" + k, d.iv[k]);
      return res.status(200).json({ data: d, imgs, maint: await S.getMaint(), theme: await S.getTheme(), promo: await S.getPromo() });
    }
    if (!String(b.action).startsWith("admin_")) return fail(res, 400, "Acción no válida");
    const bad = await checkPin(req, b.pin);
    if (bad) return fail(res, bad.code, bad.error);

    if (b.action === "admin_save") {
      const d = b.data || {}, cur = (await S.getData()).data;
      const out = { texts: {}, ship: {}, ig: "", colors: {}, iv: cur.iv || {} };
      const entries = Object.entries(d.texts && typeof d.texts === "object" ? d.texts : {});
      if (entries.length > 2000) return fail(res, 400, "Demasiados textos");
      for (const [k, v] of entries) {
        if (!/^p?[a-z0-9]{3,24}$/.test(k)) continue;
        if (typeof v !== "string" || v.length > 5000) return fail(res, 400, "Un texto es demasiado largo (máx. 5.000 caracteres)");
        out.texts[k] = v;
      }
      for (const z of Object.keys(S.ZONES)) {
        const v = d.ship && d.ship[z];
        if (v === undefined) continue;
        if (!Number.isSafeInteger(v) || v < 0 || v > 99999) return fail(res, 400, "Coste de envío no válido para " + S.ZONES[z]);
        out.ship[z] = v;
      }
      if (d.ig) {
        if (typeof d.ig !== "string" || !/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_./?=&-]{1,150}$/.test(d.ig)) return fail(res, 400, "El enlace de Instagram debe empezar por https://www.instagram.com/");
        out.ig = d.ig;
      }
      for (const k of ["pk", "la", "ab", "lr"]) {
        const v = d.colors && d.colors[k];
        if (v === undefined) continue;
        if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) return fail(res, 400, "Color no válido");
        out.colors[k] = v;
      }
      await cmd(["HSET", "site", "data", JSON.stringify(out)]);
      const check = (await S.getData()).data; // confirmación desde la base de datos
      if (JSON.stringify(check.texts) !== JSON.stringify(out.texts) || JSON.stringify(check.ship) !== JSON.stringify(out.ship)) return fail(res, 500, "La base de datos no confirmó el guardado");
      return res.status(200).json({ ok: true, data: check });
    }
    if (b.action === "admin_promo") {
      await cmd(["SET", "promo", JSON.stringify({ on: !!b.on, at: Date.now() })]);
      return res.status(200).json({ ok: true, promo: await S.getPromo() });
    }
    if (b.action === "admin_theme") {
      if (!S.THEMES.includes(b.name)) return fail(res, 400, "Tema no válido");
      const banner = typeof b.banner === "string" ? b.banner.trim() : "";
      if (banner.length > 160) return fail(res, 400, "El texto de la franja es demasiado largo (máx. 160 caracteres)");
      await cmd(["SET", "theme", JSON.stringify({ name: b.name, banner, at: Date.now() })]);
      const chk = await S.getTheme();
      if (chk.name !== b.name) return fail(res, 500, "La base de datos no confirmó el cambio");
      return res.status(200).json({ ok: true, theme: chk });
    }
    if (b.action === "admin_maint") {
      const msg = typeof b.msg === "string" ? b.msg.trim() : "";
      if (msg.length > 300) return fail(res, 400, "El mensaje es demasiado largo (máx. 300 caracteres)");
      const m = { on: !!b.on, msg, at: Date.now() };
      await cmd(["SET", "maint", JSON.stringify(m)]);
      const chk = await S.getMaint();
      if (chk.on !== m.on) return fail(res, 500, "La base de datos no confirmó el cambio");
      return res.status(200).json({ ok: true, maint: chk });
    }
    if (b.action === "admin_img") {
      if (!IMG_KEYS.includes(b.key)) return fail(res, 400, "Imagen no válida");
      const cur = (await S.getData()).data;
      cur.iv = cur.iv || {};
      if (b.img == null) { await delImg("s_" + b.key); delete cur.iv[b.key]; }
      else cur.iv[b.key] = await putImg("s_" + b.key, b.img);
      await cmd(["HSET", "site", "data", JSON.stringify(cur)]);
      return res.status(200).json({ ok: true, url: cur.iv[b.key] ? imgUrl("s_" + b.key, cur.iv[b.key]) : null });
    }
    return fail(res, 400, "Acción no válida");
  } catch (e) {
    const user = /^Imagen/.test(e.message || "");
    return fail(res, user ? 400 : 500, user ? e.message : "Error del servidor. Inténtalo de nuevo.");
  }
};
