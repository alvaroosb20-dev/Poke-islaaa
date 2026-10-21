// Aviso de pedidos por WhatsApp al dueño de la tienda (servicio gratuito CallMeBot).
const { cmd, parse } = require("./_db");

async function getWA() {
  try { return parse(await cmd(["GET", "wa:cfg"])) || { on: 0, phone: "", key: "" }; } catch (_) { return { on: 0, phone: "", key: "" }; }
}
async function sendWA(text, cfg) {
  cfg = cfg || (await getWA());
  if (!cfg.phone || !cfg.key) throw new Error("Falta el número o la clave de WhatsApp");
  const url = "https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(cfg.phone) + "&text=" + encodeURIComponent(String(text).slice(0, 3500)) + "&apikey=" + encodeURIComponent(cfg.key);
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const body = (await r.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!r.ok || /error|invalid|not valid|apikey is invalid/i.test(body)) throw new Error("WhatsApp no aceptó el mensaje: " + body.slice(0, 160));
    return true;
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "WhatsApp tardó demasiado en responder" : e.message);
  } finally { clearTimeout(t); }
}
module.exports = { getWA, sendWA };
