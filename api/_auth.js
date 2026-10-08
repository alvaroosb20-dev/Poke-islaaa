// Comprobación del PIN de administrador, con bloqueo tras demasiados intentos fallidos.
const crypto = require("crypto");
const { cmd } = require("./_db");

const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
const ipOf = (req) => String((req.headers && req.headers["x-forwarded-for"]) || "x").split(",")[0].trim().slice(0, 64);

// Devuelve null si el PIN es correcto; si no, un objeto { code, error } listo para responder.
async function checkPin(req, pin) {
  if (!process.env.ADMIN_PIN) return { code: 503, error: "Falta configurar ADMIN_PIN en Vercel" };
  const key = "pinfail:" + ipOf(req);
  let fails = 0;
  try { fails = Number(await cmd(["GET", key])) || 0; } catch (_) {}
  if (fails >= 10) return { code: 429, error: "Demasiados intentos fallidos. Espera 15 minutos." };
  const ok = typeof pin === "string" && pin.length > 0 && crypto.timingSafeEqual(hash(pin), hash(process.env.ADMIN_PIN));
  if (ok) return null;
  try { await cmd(["INCR", key]); await cmd(["EXPIRE", key, 900]); } catch (_) {}
  await new Promise((r) => setTimeout(r, 600));
  return { code: 401, error: "PIN incorrecto" };
}

module.exports = { checkPin, ipOf };
