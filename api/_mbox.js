// Lógica de las PokeRuletas: cajas, premios, stock, sorteo seguro y tickets de giro.
const crypto = require("crypto");
const { cmd, parse, hvals } = require("./_db");
const { putImg, delImg, imgUrl, checkImg } = require("./_img");
const { customer } = require("./_stripe");

const SHIP = ["Pendiente", "Preparando", "Enviado", "Entregado"];
const RAR = ["Común", "Raro", "Épico", "Legendario"];
const isInt = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const cents = (p) => Math.round(Number(p) * 100); // probabilidad en centésimas de %

// Migración: las cajas de la versión anterior guardaban las fotos dentro de la caja
async function migrate(b) {
  if (!b) return b;
  let changed = false;
  if (isData(b.img)) { try { b.iv = await putImg("b" + b.id, b.img); } catch (_) {} delete b.img; changed = true; }
  for (const p of b.prizes || []) {
    if (isData(p.img)) { try { p.iv = await putImg("z" + b.id + "_" + p.id, p.img); } catch (_) {} delete p.img; changed = true; }
    if (p.stock === undefined) { p.stock = null; changed = true; }
  }
  if (changed) await cmd(["HSET", "mbox", String(b.id), JSON.stringify(b)]);
  return b;
}
const allBoxesRaw = async () => {
  const l = hvals(await cmd(["HGETALL", "mbox"]));
  for (const b of l) await migrate(b);
  return l.sort((a, b) => (a.ord || 0) - (b.ord || 0) || a.id - b.id);
};
const getBox = async (id) => {
  if (!Number.isSafeInteger(id)) return null;
  const r = await cmd(["HMGET", "mbox", String(id)]);
  return r && r[0] ? migrate(parse(r[0])) : null;
};

// Añade a cada premio el stock que queda ("left": null = ilimitado)
async function withStock(box) {
  if (!box) return box;
  const raw = await cmd(["HGETALL", "mbstk:" + box.id]);
  const m = {};
  if (Array.isArray(raw)) for (let i = 0; i < raw.length; i += 2) m[raw[i]] = Number(raw[i + 1]);
  else if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw)) m[k] = Number(v);
  box.prizes = (box.prizes || []).map((p) => ({ ...p, left: Object.prototype.hasOwnProperty.call(m, p.id) ? Math.max(0, m[p.id]) : null }));
  return box;
}

const activePrizes = (b) => (b.prizes || []).filter((p) => p.on);
// Premios que pueden salir: activos, con probabilidad mayor que 0 y con stock
const available = (b) => activePrizes(b).filter((p) => cents(p.p) > 0 && (p.left == null || p.left > 0));
const sums100 = (b) => { const a = activePrizes(b); return a.length > 0 && a.reduce((s, p) => s + cents(p.p), 0) === 10000; };
const sellable = (b) => !!(b && b.active && sums100(b) && available(b).length > 0);
// Motivo por el que una caja no está a la venta (null = sí está a la venta)
function why(b) {
  if (!b) return "La caja no existe";
  if (!b.active) return "No tiene marcada la casilla «Caja activa»";
  const a = activePrizes(b);
  if (!a.length) return "No tiene ningún premio marcado como «Activo»";
  const s = a.reduce((t, p) => t + cents(p.p), 0);
  if (s !== 10000) return "Las probabilidades de los premios activos suman " + String(s / 100).replace(".", ",") + " % y tienen que sumar 100 %";
  if (!available(b).length) return "Todos los premios están agotados (stock 0)";
  return null;
}

// Probabilidad real de cada premio disponible (si uno se agota, los demás se reparten su parte)
function effective(b) {
  const a = available(b), tot = a.reduce((s, p) => s + cents(p.p), 0);
  return a.map((p) => ({ ...p, pe: tot ? Math.round((cents(p.p) / tot) * 10000) / 100 : 0 }));
}

const boxImg = (b) => imgUrl("b" + b.id, b.iv);
const prizeImg = (b, p) => imgUrl("z" + b.id + "_" + p.id, p.iv);

// Vista pública: solo lo que el cliente necesita ver
function pub(b) {
  return {
    id: b.id, name: b.name, desc: b.desc, price: b.price, img: boxImg(b),
    prizes: effective(b).map((p) => ({ id: p.id, name: p.name, desc: p.desc, rarity: p.rarity || "Común", img: prizeImg(b, p), value: p.value, p: 1, color: p.color, left: p.left })), // p: 1 = todos los sectores iguales; la probabilidad real no se publica
    soldOut: activePrizes(b).filter((p) => p.left === 0).map((p) => ({ name: p.name, rarity: p.rarity || "Común", value: p.value })),
  };
}

// Vista de administración: incluye premios inactivos, stock y URLs de imagen
function adm(b) {
  return { ...b, why: why(b), img: boxImg(b), prizes: (b.prizes || []).map((p) => ({ ...p, img: prizeImg(b, p) })) };
}

const isData = (v) => typeof v === "string" && v.startsWith("data:image/");

// Valida y guarda una caja. Las imágenes nuevas llegan como data:image; "rmImg" las quita.
async function saveBox(input) {
  if (!input || typeof input !== "object") throw new Error("Datos no válidos");
  const str = (v, max, req, what) => {
    const s = String(v == null ? "" : v).trim();
    if (req && !s) throw new Error("Falta " + what);
    if (s.length > max) throw new Error(what + " demasiado largo (máx. " + max + ")");
    return s;
  };
  if (!isInt(input.price, 50)) throw new Error("El precio mínimo de la caja es 0,50 €");
  if (input.price > 10000000) throw new Error("Precio de la caja no válido");
  if (!Array.isArray(input.prizes) || input.prizes.length > 30) throw new Error("Máximo 30 premios");
  const id = isInt(input.id, 1) ? input.id : Date.now();
  const prev = (await getBox(id)) || { prizes: [] };
  const prevP = Object.fromEntries((prev.prizes || []).map((p) => [p.id, p]));
  const seen = new Set();

  const prizes = input.prizes.map((p, i) => {
    const n = i + 1;
    if (!isInt(p.value, 0) || p.value > 100000000) throw new Error("Valor no válido en el premio " + n);
    const pr = Number(p.p);
    if (!Number.isFinite(pr) || pr < 0 || pr > 100) throw new Error("Probabilidad no válida en el premio " + n + " (entre 0 y 100)");
    if (Math.abs(pr * 100 - Math.round(pr * 100)) > 1e-6) throw new Error("Usa como máximo 2 decimales en la probabilidad del premio " + n);
    let stock = null;
    if (p.stock !== null && p.stock !== undefined && p.stock !== "") {
      if (!isInt(Number(p.stock), 0) || Number(p.stock) > 1000000) throw new Error("Stock no válido en el premio " + n);
      stock = Number(p.stock);
    }
    let pid = /^[a-z0-9]{3,20}$/i.test(String(p.id || "")) ? String(p.id).toLowerCase() : crypto.randomBytes(4).toString("hex");
    while (seen.has(pid)) pid = crypto.randomBytes(4).toString("hex");
    seen.add(pid);
    if (isData(p.img)) checkImg(p.img);
    return {
      id: pid, name: str(p.name, 120, true, "el nombre del premio " + n), desc: str(p.desc, 300, false, "Descripción"),
      value: p.value, p: Math.round(pr * 100) / 100, rarity: RAR.includes(p.rarity) ? p.rarity : "Común",
      color: /^#[0-9a-f]{6}$/i.test(String(p.color || "")) ? p.color.toLowerCase() : "#444444",
      on: p.on ? 1 : 0, stock, iv: prevP[pid] ? prevP[pid].iv || null : null,
      _img: isData(p.img) ? p.img : null, _rm: !!p.rmImg, _stock0: p.stock0,
    };
  });
  if (isData(input.img)) checkImg(input.img);
  const box = {
    id, name: str(input.name, 120, true, "el nombre de la caja"), desc: str(input.desc, 300, false, "Descripción"),
    price: input.price, active: input.active ? 1 : 0, ord: isInt(input.ord) ? input.ord : prev.ord || 0,
    iv: prev.iv || null, prizes, updated: Date.now(),
  };
  if (box.active && !sums100(box)) {
    const s = activePrizes(box).reduce((t, p) => t + cents(p.p), 0) / 100;
    throw new Error("Las probabilidades de los premios activos suman " + s + "% y deben sumar exactamente 100%");
  }

  // Imágenes
  if (isData(input.img)) box.iv = await putImg("b" + id, input.img);
  else if (input.rmImg) { await delImg("b" + id); box.iv = null; }
  for (const p of prizes) {
    const k = "z" + id + "_" + p.id;
    if (p._img) p.iv = await putImg(k, p._img);
    else if (p._rm) { await delImg(k); p.iv = null; }
  }
  for (const old of prev.prizes || []) if (!seen.has(old.id)) await delImg("z" + id + "_" + old.id);

  // Stock: solo se toca si el administrador lo ha cambiado (así no se pisan ventas recientes)
  const stk = "mbstk:" + id;
  for (const p of prizes) {
    const before = prevP[p.id];
    const edited = p._stock0 === undefined || String(p._stock0 ?? "") !== String(p.stock ?? "");
    if (p.stock === null) await cmd(["HDEL", stk, p.id]);
    else if (!before || before.stock == null || edited) await cmd(["HSET", stk, p.id, String(p.stock)]);
  }
  for (const old of prev.prizes || []) if (!seen.has(old.id)) await cmd(["HDEL", stk, old.id]);

  for (const p of prizes) { delete p._img; delete p._rm; delete p._stock0; }
  await cmd(["HSET", "mbox", String(id), JSON.stringify(box)]);
  return box;
}

async function deleteBox(id) {
  const b = await getBox(id);
  if (!b) return;
  await delImg("b" + id);
  for (const p of b.prizes || []) await delImg("z" + id + "_" + p.id);
  await cmd(["DEL", "mbstk:" + id]);
  await cmd(["HDEL", "mbox", String(id)]);
}

// Sorteo: número aleatorio criptográfico del servidor, ponderado por las probabilidades.
// Reserva el stock de forma atómica (HINCRBY); si otro jugador se llevó la última unidad, repite.
async function draw(boxId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const box = await withStock(await getBox(boxId));
    if (!box || !sums100(box)) throw new Error("Esta caja no está disponible ahora");
    const cand = available(box);
    if (!cand.length) throw new Error("Todos los premios de esta caja están agotados");
    const total = cand.reduce((s, p) => s + cents(p.p), 0);
    const rnd = crypto.randomInt(0, total);
    let acc = 0, prize = cand[cand.length - 1];
    for (const p of cand) { acc += cents(p.p); if (rnd < acc) { prize = p; break; } }
    if (prize.left != null) {
      const n = Number(await cmd(["HINCRBY", "mbstk:" + boxId, prize.id, "-1"]));
      if (n < 0) { await cmd(["HINCRBY", "mbstk:" + boxId, prize.id, "1"]); continue; }
    }
    return { box, prize, rnd, total, candidates: cand.map((p) => ({ id: p.id, name: p.name, w: cents(p.p), left: p.left })) };
  }
  throw new Error("Hay mucha demanda ahora mismo. Inténtalo de nuevo en unos segundos.");
}

async function restock(boxId, prize) {
  if (prize && prize.left != null) await cmd(["HINCRBY", "mbstk:" + boxId, prize.id, "1"]).catch(() => {});
}

// Crea (una sola vez por pago) el ticket que da derecho a un giro
async function ensureTicket(s) {
  const key = "tk:s:" + s.id;
  let tok = await cmd(["GET", key]);
  if (tok && (await getTicket(tok))) return tok;
  if (!tok) {
    tok = crypto.randomBytes(16).toString("hex");
    if ((await cmd(["SET", key, tok, "NX"])) !== "OK") {
      const won = await cmd(["GET", key]);
      for (let i = 0; i < 20 && !(await getTicket(won)); i++) await new Promise((r) => setTimeout(r, 100));
      return won;
    }
  }
  const boxId = Number(s.metadata && s.metadata.boxId), box = await getBox(boxId);
  const c = customer(s);
  const t = {
    token: tok, boxId, boxName: box ? box.name : "PokeRuleta",
    price: s.amount_subtotal != null ? s.amount_subtotal : s.amount_total, total: s.amount_total,
    session: s.id, pi: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || "",
    ...c, zone: (s.metadata && s.metadata.zone) || "", created: Date.now(), status: "pending", prize: null, ship: "Pendiente",
  };
  await cmd(["HSET", "tickets", tok, JSON.stringify(t)]);
  return tok;
}

const getTicket = async (tok) => {
  if (!/^[a-f0-9]{32}$/.test(String(tok || ""))) return null;
  const r = await cmd(["HMGET", "tickets", tok]);
  return r && r[0] ? parse(r[0]) : null;
};

module.exports = { SHIP, RAR, why, getBox, allBoxesRaw, withStock, available, sellable, pub, adm, saveBox, deleteBox, draw, restock, ensureTicket, getTicket, effective };
