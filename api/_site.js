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
module.exports = { ZONES, DEF, getData, shipTable };
