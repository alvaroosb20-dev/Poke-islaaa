const { cmd } = require("./_db");
const { KEY } = require("./_img");

module.exports = async (req, res) => {
  try {
    const k = String((req.query && req.query.k) || new URL(req.url, "http://x").searchParams.get("k") || "");
    if (!KEY.test(k)) return res.status(400).send("Imagen no válida");
    const data = await cmd(["GET", "img:" + k]);
    const m = typeof data === "string" && data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) { res.setHeader("Cache-Control", "no-store"); return res.status(404).send("No encontrada"); }
    res.setHeader("Content-Type", m[1]);
    // La URL lleva la versión (?v=), así que puede guardarse en caché para siempre
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    return res.status(200).send(Buffer.from(m[2], "base64"));
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).send("Error");
  }
};
