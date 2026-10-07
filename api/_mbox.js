const crypto = require("crypto");
const { cmd } = require("./_db");

const SHIP = ["Pendiente", "Preparando", "Enviado", "Entregado"];
const RAR = ["Común", "Raro", "Épico", "Legendario"];
const parse = (x) => { try { return JSON.parse(x); } catch (_) { return null; } };
const isInt = (v, min = 0) => Number.isSafeInteger(v) && v >= min;

function list(raw) {
  const out = [];
  if (Array.isArray(raw)) for (let i = 0; i < raw.length; i += 2) { const o = parse(raw[i + 1]); if (o) out.push(o); }
  else if (raw && typeof raw === "object") for (const v of Object.values(raw)) { const o = typeof v === "string" ? parse(v) : v; if (o) out.push(o); }
  return out;
}
const allBoxes = async () => list(await cmd(["HGETALL", "mbox"])).sort((a, b) => (a.ord || 0) - (b.ord || 0) || a.id - b.id);
const getBox = async (id) => { if (!Number.isSafeInteger(id)) return null; const r = await cmd(["HMGET", "mbox", String(id)]); return r[0] ? parse(r[0]) : null; };
const active = (b) => (b.prizes || []).filter((p) => p.on);
const valid = (b) => { const a = active(b); return a.length > 0 && a.reduce((s, p) => s + Math.round(p.p * 100), 0) === 10000; };
const pub = (b) => ({ id: b.id, name: b.name, desc: b.desc, price: b.price, img: b.img || null,
  prizes: active(b).map((p) => ({ id: p.id, name: p.name, desc: p.desc, rarity: p.rarity || "Común", img: p.img || null, value: p.value, p: p.p, color: p.color })) });

function validateBox(b) {
  if (!b || typeof b !== "object") throw new Error("Datos no válidos");
  const str = (v, max, req) => { const s = String(v == null ? "" : v).trim(); if ((req && !s) || s.length > max) throw new Error("Texto no válido"); return s; };
  const img = (v, max) => { if (!v) return null; if (typeof v !== "string" || !v.startsWith("data:image/") || v.length > max) throw new Error("Imagen no válida o demasiado grande"); return v; };
  if (!isInt(b.price, 50)) throw new Error("El precio mínimo es 0,50 €");
  if (!Array.isArray(b.prizes) || b.prizes.length > 30) throw new Error("Máximo 30 premios");
  const prizes = b.prizes.map((p) => {
    if (!isInt(p.value, 0) || p.value > 100000000) throw new Error("Valor de premio no válido");
    const pr = Number(p.p);
    if (!Number.isFinite(pr) || pr < 0 || pr > 100) throw new Error("Probabilidad no válida");
    return { id: /^[a-z0-9]{3,20}$/i.test(String(p.id || "")) ? String(p.id) : crypto.randomBytes(4).toString("hex"),
      name: str(p.name, 120, true), desc: str(p.desc, 300), value: p.value, p: Math.round(pr * 100) / 100,
      rarity: RAR.includes(p.rarity) ? p.rarity : "Común", color: /^#[0-9a-f]{6}$/i.test(String(p.color || "")) ? p.color : "#444444", on: p.on ? 1 : 0, img: img(p.img, 250000) };
  });
  const box = { id: Number.isSafeInteger(b.id) ? b.id : Date.now(), name: str(b.name, 120, true), desc: str(b.desc, 300), price: b.price,
    img: img(b.img, 500000), active: b.active ? 1 : 0, ord: isInt(b.ord) ? b.ord : 0, prizes };
  if (box.active && !valid(box)) throw new Error("Las probabilidades de los premios activos deben sumar exactamente 100%");
  return box;
}

function pick(box) {
  const a = active(box), tot = a.reduce((s, p) => s + Math.round(p.p * 100), 0);
  let r = crypto.randomInt(0, tot);
  for (const p of a) { r -= Math.round(p.p * 100); if (r < 0) return p; }
  return a[a.length - 1];
}

async function ensureTicket(s) {
  const key = "tk:s:" + s.id;
  let tok = await cmd(["GET", key]);
  if (tok) return tok;
  const boxId = Number(s.metadata && s.metadata.boxId), box = await getBox(boxId);
  const cd = s.customer_details || {};
  const sh = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || {};
  const a = sh.address || cd.address || {};
  tok = crypto.randomBytes(16).toString("hex");
  const t = { token: tok, boxId, boxName: box ? box.name : "Mystery Box", price: s.amount_subtotal != null ? s.amount_subtotal : s.amount_total,
    session: s.id, email: cd.email || "", name: sh.name || cd.name || "", phone: cd.phone || "",
    address: [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.state].filter(Boolean).join(", "),
    zone: (s.metadata && s.metadata.zone) || "", created: Date.now(), status: "pending", prize: null, ship: "Pendiente" };
  await cmd(["HSET", "tickets", tok, JSON.stringify(t)]);
  if ((await cmd(["SET", key, tok, "NX"])) !== "OK") { await cmd(["HDEL", "tickets", tok]); tok = await cmd(["GET", key]); }
  return tok;
}

module.exports = { SHIP, parse, list, allBoxes, getBox, active, valid, pub, validateBox, pick, ensureTicket };
