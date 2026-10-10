const { cmd, parse } = require("./_db");
const ZONES = { canarias: "Canarias", peninsula: "Península", baleares: "Baleares", ceutamelilla: "Ceuta / Melilla" };
const DEF = { canarias: 500, peninsula: 650, baleares: 850, ceutamelilla: 1200 };

async function getData() {
  const r = await cmd(["HMGET", "site", "data"]);
  return { data: (r && parse(r[0])) || {} };
}
async function shipTable() {
  let data = {};
  try { data = (await getData()).data; } catch (_) {}
  const out = {};
  for (const z in ZONES) { const v = data.ship && data.ship[z]; out[z] = [ZONES[z], Number.isSafeInteger(v) && v >= 0 ? v : DEF[z]]; }
  return out;
}
// Modo mantenimiento: { on, msg }. Si la base de datos falla, la tienda sigue abierta.
async function getMaint() {
  try { const m = parse(await cmd(["GET", "maint"])) || {}; return { on: !!m.on, msg: typeof m.msg === "string" ? m.msg : "" }; }
  catch (_) { return { on: false, msg: "" }; }
}
// Tema de temporada: { name: "normal" | "halloween", banner }
const THEMES = ["normal", "halloween"];
async function getTheme() {
  try { const t = parse(await cmd(["GET", "theme"])) || {}; return { name: THEMES.includes(t.name) ? t.name : "normal", banner: typeof t.banner === "string" ? t.banner : "" }; }
  catch (_) { return { name: "normal", banner: "" }; }
}
async function getPromo() {
  try { const p = parse(await cmd(["GET", "promo"])) || {}; return { on: p.on !== false }; } catch (_) { return { on: true }; }
}
// Inauguración: { on, at, title, msg, sndv }. Mientras esté activa y no haya llegado la hora, la tienda está cerrada.
async function getLaunch() {
  try { const l = parse(await cmd(["GET", "launch"])) || {}; return { on: !!l.on, at: Number(l.at) || 0, title: l.title || "", msg: l.msg || "", sndv: l.sndv || null }; }
  catch (_) { return { on: false, at: 0, title: "", msg: "", sndv: null }; }
}
const launchActive = (l) => l.on && l.at > Date.now();
// Motivo por el que no se puede comprar ahora mismo (null = se puede)
async function blocked() {
  if ((await getMaint()).on) return MAINT_MSG;
  const l = await getLaunch();
  if (launchActive(l)) return "La tienda aún no ha abierto. ¡Vuelve el día de la inauguración!";
  return null;
}
const MAINT_MSG = "La tienda está en mantenimiento ahora mismo. Vuelve en un rato, ¡gracias!";
module.exports = { ZONES, DEF, getData, shipTable, getMaint, MAINT_MSG, THEMES, getTheme, getPromo, getLaunch, launchActive, blocked };
