// Registro de compras (tienda y PokeRuleta) con su estado de pago.
const { cmd, parse, hvals } = require("./_db");

const STATUS = {
  pendiente: "Pendiente de pago",
  pago_pendiente: "Pago en proceso",
  pagado: "Pagado",
  fallido: "Pago fallido",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
};
// Cambios de estado permitidos: un pago confirmado no vuelve atrás por un aviso tardío
const NEXT = {
  pendiente: ["pago_pendiente", "pagado", "fallido", "cancelado"],
  pago_pendiente: ["pagado", "fallido", "cancelado"],
  fallido: ["pagado"],
  cancelado: ["pagado"],
  pagado: ["reembolsado"],
  reembolsado: [],
};

async function getPurchase(sid) {
  const r = await cmd(["HMGET", "purchases", sid]);
  return r && r[0] ? parse(r[0]) : null;
}

async function setPurchase(sid, patch, src) {
  // Bloqueo corto para que dos avisos simultáneos no se pisen
  for (let i = 0; i < 20; i++) {
    if ((await cmd(["SET", "lock:pur:" + sid, "1", "NX", "EX", "10"])) === "OK") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    const cur = (await getPurchase(sid)) || { id: sid, created: Date.now(), status: "pendiente", history: [] };
    const next = { ...cur, ...patch, updated: Date.now() };
    if (patch.status && patch.status !== cur.status) {
      if (!(NEXT[cur.status] || []).includes(patch.status)) next.status = cur.status;
      else next.history = [...(cur.history || []), { at: Date.now(), status: patch.status, src: src || "" }].slice(-20);
    } else if (patch.status) next.status = cur.status;
    if (next.status === "pagado" && !next.paidAt) next.paidAt = Date.now();
    await cmd(["HSET", "purchases", sid, JSON.stringify(next)]);
    if (next.pi) await cmd(["SET", "pi:" + next.pi, sid]);
    return next;
  } finally {
    await cmd(["DEL", "lock:pur:" + sid]).catch(() => {});
  }
}

async function listPurchases(limit = 300) {
  return hvals(await cmd(["HGETALL", "purchases"])).sort((a, b) => b.created - a.created).slice(0, limit);
}

module.exports = { STATUS, getPurchase, setPurchase, listPurchases };
