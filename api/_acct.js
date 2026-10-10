// Sesiones de cliente (inicio de sesión sin contraseña) y utilidades del sorteo mensual.
const crypto = require("crypto");
const { cmd } = require("./_db");

const TOK = /^[a-f0-9]{48}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/;
async function emailOf(tok) {
  if (!TOK.test(String(tok || ""))) return null;
  return (await cmd(["GET", "sess:" + tok])) || null;
}
async function newSession(email) {
  const t = crypto.randomBytes(24).toString("hex");
  await cmd(["SET", "sess:" + t, email, "EX", String(365 * 86400)]);
  return t;
}
// Mes en horario de Canarias: "2026-10"
const TZ = "Atlantic/Canary";
const monthKey = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(new Date(ts)).slice(0, 7);
// Instante en que termina un mes (medianoche del día 1 del mes siguiente, hora de Canarias)
function monthEnd(key) {
  const [y, m] = key.split("-").map(Number), guess = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date(guess))) % 24;
  return guess - h * 3600000;
}
const maskEmail = (e) => { const [u, d] = String(e).split("@"); return (u || "").slice(0, 1) + "***@" + (d || ""); };
const shortName = (n) => { const p = String(n || "").trim().split(/\s+/).filter(Boolean); return p.length ? p[0] + (p[1] ? " " + p[1][0] + "." : "") : "Cliente"; };

module.exports = { TOK, EMAIL, emailOf, newSession, monthKey, monthEnd, maskEmail, shortName };
