// Envío de correos con Resend.
async function sendMail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) throw new Error("Falta RESEND_API_KEY");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "Poke Islas <pedidos@poke-isla.com>", to: [to], subject, html }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || "Resend " + r.status); }
  return true;
}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const wrap = (body) => `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0c1a1e"><h1 style="margin:0 0 16px">POKE <span style="color:#e0a800">ISLAS</span></h1>${body}<p style="color:#888;font-size:12px;margin-top:28px">Poke Islas · Pokémon Grade · Canarias</p></div>`;
module.exports = { sendMail, esc, wrap };
