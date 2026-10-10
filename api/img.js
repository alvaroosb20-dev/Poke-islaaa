const { cmd } = require("./_db");
const { KEY } = require("./_img");

// Sirve la música con soporte de rangos (Safari lo necesita para reproducir audio)
async function serveSnd(req, res) {
  let meta = null;
  try { meta = JSON.parse(await cmd(["GET", "snd:meta"])); } catch (_) {}
  if (!meta) { res.setHeader("Cache-Control", "no-store"); return res.status(404).send("Sin música"); }
  const parts = [];
  for (let i = 0; i < meta.n; i++) parts.push(Buffer.from(String((await cmd(["GET", "snd:c" + i])) || ""), "base64"));
  const buf = Buffer.concat(parts), total = buf.length;
  res.setHeader("Content-Type", meta.type === "audio/mp3" ? "audio/mpeg" : meta.type);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  const m = /bytes=(\d*)-(\d*)/.exec(String((req.headers && req.headers.range) || ""));
  if (m && (m[1] !== "" || m[2] !== "")) {
    let a = m[1] === "" ? total - Number(m[2]) : Number(m[1]);
    let z = m[1] !== "" && m[2] !== "" ? Number(m[2]) : total - 1;
    a = Math.max(0, a); z = Math.min(total - 1, z);
    if (a > z) { res.setHeader("Content-Range", "bytes */" + total); return res.status(416).end(); }
    res.setHeader("Content-Range", `bytes ${a}-${z}/${total}`);
    res.setHeader("Content-Length", String(z - a + 1));
    return res.status(206).send(buf.subarray(a, z + 1));
  }
  res.setHeader("Content-Length", String(total));
  return res.status(200).send(buf);
}

module.exports = async (req, res) => {
  try {
    const k = String((req.query && req.query.k) || new URL(req.url, "http://x").searchParams.get("k") || "");
    if (k === "snd") return serveSnd(req, res); // música de la inauguración
    if (!KEY.test(k)) return res.status(400).send("Imagen no válida");
    const data = await cmd(["GET", "img:" + k]);
    const m = typeof data === "string" && data.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([\s\S]+)$/i);
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
