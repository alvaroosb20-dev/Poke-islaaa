const { cmd } = require("./_db");
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clean = (v, n) => String(v || "").replace(/[\r\n]+/g, " ").trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const b = req.body || {};
    if (b.web) return res.status(200).json({ ok: true });
    const nombre = clean(b.nombre, 100), email = clean(b.email, 150), whatsapp = clean(b.whatsapp, 40);
    const tipo = clean(b.tipo, 60), precio = clean(b.precio, 60);
    const desc = String(b.desc || "").trim().slice(0, 3000), mensaje = String(b.mensaje || "").trim().slice(0, 3000);
    if (!nombre || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Escribe tu nombre y un email válido" });
    const fotos = (Array.isArray(b.fotos) ? b.fotos : []).slice(0, 5).filter((f) => typeof f === "string" && /^data:image\/jpeg;base64,/.test(f) && f.length < 1500000);
    try {
      await cmd(["LPUSH", "ventas", JSON.stringify({ fecha: new Date().toISOString(), nombre, email, whatsapp, tipo, precio, desc, mensaje, fotos: fotos.length })]);
    } catch (_) {}
    const fila = (k, v) => `<tr><td style="padding:6px 12px;font-weight:bold;vertical-align:top">${k}</td><td style="padding:6px 12px">${esc(v).replace(/\n/g, "<br>") || "-"}</td></tr>`;
    const html = `<h2>Nueva solicitud para vender</h2><table>${fila("Nombre", nombre)}${fila("Email", email)}${fila("WhatsApp", whatsapp)}${fila("Tipo de producto", tipo)}${fila("Precio orientativo", precio)}${fila("Descripción", desc)}${fila("Mensaje", mensaje)}${fila("Fotos adjuntas", String(fotos.length))}</table>`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Poke Islas <onboarding@resend.dev>",
        to: [process.env.VENTAS_EMAIL || "pokeislatcg@gmail.com"],
        reply_to: email,
        subject: "Quiero vender: " + (tipo || "producto") + " - " + nombre,
        html,
        attachments: fotos.map((f, i) => ({ filename: "foto-" + (i + 1) + ".jpg", content: f.split(",")[1] })),
      }),
    });
    if (!r.ok) return res.status(502).json({ error: "No se pudo enviar el correo. Escríbenos por Instagram." });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Error al enviar. Inténtalo de nuevo." });
  }
};
