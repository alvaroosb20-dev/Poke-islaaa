// Códigos de descuento de la tienda: % o importe fijo, pedido mínimo, usos máximos y caducidad.
const { cmd, parse, hvals } = require("./_db");

const CODE = /^[A-Z0-9_-]{3,24}$/;
const norm = (c) => String(c || "").trim().toUpperCase();
const eur = (c) => (c / 100).toFixed(2).replace(".", ",") + " €";
const userErr = (m) => Object.assign(new Error(m), { user: true });

async function getCoupon(code) {
  code = norm(code);
  if (!CODE.test(code)) return null;
  return parse((await cmd(["HMGET", "coupons", code]))[0]);
}
const usesOf = async (code) => Number((await cmd(["HMGET", "cpuse", norm(code)]))[0]) || 0;

// Calcula el descuento de un código para un subtotal (en céntimos). Lanza un error legible si no vale.
async function evalCoupon(code, subtotal) {
  const c = await getCoupon(code);
  if (!c || !c.on) throw userErr("Este código no existe o no está activo");
  if (c.exp && Date.now() > c.exp) throw userErr("Este código ha caducado");
  if (c.min && subtotal < c.min) throw userErr("Este código es para pedidos desde " + eur(c.min));
  if (c.max && (await usesOf(c.code)) >= c.max) throw userErr("Este código ya se ha agotado");
  const discount = Math.min(subtotal, c.type === "pct" ? Math.round((subtotal * c.val) / 100) : c.val);
  if (!(discount > 0)) throw userErr("Este código no se puede aplicar a este pedido");
  return { code: c.code, discount, label: c.type === "pct" ? "-" + c.val + "%" : "-" + eur(c.val) };
}

function cleanCoupon(b) {
  const code = norm(b.code);
  if (!CODE.test(code)) throw userErr("El código debe tener de 3 a 24 letras o números (sin espacios)");
  const type = b.type === "eur" ? "eur" : "pct";
  const val = Number(b.val);
  if (type === "pct" && !(Number.isInteger(val) && val >= 1 && val <= 100)) throw userErr("El porcentaje debe estar entre 1 y 100");
  if (type === "eur" && !(Number.isInteger(val) && val >= 1 && val <= 10000000)) throw userErr("Importe de descuento no válido");
  const min = b.min ? Number(b.min) : 0;
  if (!(Number.isInteger(min) && min >= 0)) throw userErr("Pedido mínimo no válido");
  const max = b.max ? Number(b.max) : 0;
  if (!(Number.isInteger(max) && max >= 0 && max <= 1000000)) throw userErr("Número de usos no válido");
  const exp = b.exp ? Number(b.exp) : 0;
  if (exp && !(Number.isSafeInteger(exp) && exp > 0)) throw userErr("Fecha de caducidad no válida");
  return { code, type, val, min, max, exp, on: b.on ? 1 : 0, note: String(b.note || "").slice(0, 80) };
}

async function listCoupons() {
  const l = hvals(await cmd(["HGETALL", "coupons"]));
  const u = await cmd(["HGETALL", "cpuse"]);
  const m = {};
  if (Array.isArray(u)) for (let i = 0; i < u.length; i += 2) m[u[i]] = Number(u[i + 1]);
  return l.map((c) => ({ ...c, uses: m[c.code] || 0 })).sort((a, b) => (b.created || 0) - (a.created || 0));
}

module.exports = { norm, evalCoupon, cleanCoupon, listCoupons, getCoupon };
