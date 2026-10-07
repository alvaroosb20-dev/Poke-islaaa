const { cmd } = require("./_db");
const ZONES = { canarias: "Canarias", peninsula: "Península", baleares: "Baleares", ceutamelilla: "Ceuta / Melilla" };
const DEF = { canarias: 500, peninsula: 650, baleares: 850, ceutamelilla: 1200 };
const parse = (x) => { try { return JSON.parse(x); } catch (_) { return null; } };

async function getData() {
  try {
    const r = await cmd(["HMGET", "site", "data", "imgs"]);
    return { data: parse(r[0]) || {}, imgs: parse(r[1]) || {} };
  } catch (_) { return { data: {}, imgs: {} }; }
}
async function shipTable() {
  const { data } = await getData(), out = {};
  for (const z in ZONES) { const v = data.ship && data.ship[z]; out[z] = [ZONES[z], Number.isSafeInteger(v) && v >= 0 ? v : DEF[z]]; }
  return out;
}
module.exports = { ZONES, DEF, getData, shipTable };
