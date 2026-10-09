// Cuentas de cliente (código por email, sin contraseña) y sorteo mensual de una carta.
const crypto = require("crypto");
const { cmd, parse, hvals } = require("./_db");
const { checkPin, ipOf } = require("./_auth");
const { listPurchases } = require("./_orders");
const { putImg, delImg, imgUrl, checkImg } = require("./_img");
const { sendMail, esc, wrap } = require("./_mail");
const A = require("./_acct");

const fail = (res, c, m) => res.status(c).json({ error: m });
const H = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const lc = (e) => String(e || "").trim().toLowerCase();
const rate = async (k, max, sec) => { const n = Number(await cmd(["INCR", k])); if (n === 1) await cmd(["EXPIRE", k, String(sec)]); return n <= max; };

const paidOf = async () => (await listPurchases(5000)).filter((p) => p.status === "pagado" && (p.email || p.account));
const emailP = (p) => lc(p.email || p.account);

// Participaciones de un mes: una por cada compra pagada
async function entries(month) {
  const m = {};
  for (const p of await paidOf()) {
    if (A.monthKey(p.paidAt || p.created) !== month) continue;
    const e = emailP(p);
    m[e] = m[e] || { email: e, name: p.name || "", n: 0 };
    m[e].n++;
    if (p.name) m[e].name = p.name;
  }
  return Object.values(m).sort((a, b) => b.n - a.n);
}
const getCfg = async () => parse(await cmd(["GET", "gw:cfg"])) || { on: 0, title: "", desc: "", iv: null };
const winners = async () => hvals(await cmd(["HGETALL", "gw:win"])).sort((a, b) => (a.month < b.month ? 1 : -1));

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return fail(res, 405, "Método no permitido");
  const b = req.body || {};
  try {
    // ---------- Inicio de sesión ----------
    if (b.action === "send_code") {
      const email = lc(b.email);
      if (!A.EMAIL.test(email)) return fail(res, 400, "Escribe un email válido");
      if (!(await rate("lcr:" + H(email) + ":" + Math.floor(Date.now() / 3600000), 5, 3700)) || !(await rate("lci:" + ipOf(req) + ":" + Math.floor(Date.now() / 3600000), 12, 3700)))
        return fail(res, 429, "Has pedido demasiados códigos. Espera un rato y vuelve a intentarlo.");
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      await cmd(["SET", "lc:" + H(email), H(code + email), "EX", "600"]);
      await cmd(["DEL", "lct:" + H(email)]);
      try {
        await sendMail(email, "Tu código para entrar en Poke Islas: " + code, wrap(`<p>Tu código para iniciar sesión es:</p><p style="font-size:34px;font-weight:bold;letter-spacing:8px;background:#fff8d6;padding:14px;border-radius:12px;text-align:center">${code}</p><p>Caduca en 10 minutos. Si no lo has pedido tú, ignora este correo.</p>`));
      } catch (e) {
        console.error("login mail", e.message);
        return fail(res, 502, "No pudimos enviarte el código ahora mismo. Inténtalo más tarde o escríbenos por Instagram @poke_islas.");
      }
      return res.status(200).json({ ok: true });
    }
    if (b.action === "verify") {
      const email = lc(b.email), code = String(b.code || "").replace(/\D/g, "");
      if (!A.EMAIL.test(email) || code.length !== 6) return fail(res, 400, "Escribe el código de 6 cifras");
      const k = "lc:" + H(email), saved = await cmd(["GET", k]);
      if (!saved) return fail(res, 400, "El código ha caducado. Pide uno nuevo.");
      const tries = Number(await cmd(["INCR", "lct:" + H(email)]));
      if (tries === 1) await cmd(["EXPIRE", "lct:" + H(email), "600"]);
      if (tries > 5) { await cmd(["DEL", k]); return fail(res, 429, "Demasiados intentos. Pide un código nuevo."); }
      if (!crypto.timingSafeEqual(Buffer.from(saved), Buffer.from(H(code + email)))) return fail(res, 400, "Código incorrecto");
      await cmd(["DEL", k]);
      const prev = parse((await cmd(["HMGET", "users", email]))[0]) || { email, created: Date.now() };
      await cmd(["HSET", "users", email, JSON.stringify({ ...prev, last: Date.now() })]);
      return res.status(200).json({ token: await A.newSession(email), email });
    }
    if (b.action === "logout") {
      if (A.TOK.test(String(b.token || ""))) await cmd(["DEL", "sess:" + b.token]);
      return res.status(200).json({ ok: true });
    }
    if (b.action === "me") {
      const email = await A.emailOf(b.token);
      if (!email) return fail(res, 401, "Tu sesión ha caducado. Vuelve a iniciar sesión.");
      const mine = (await listPurchases(5000)).filter((p) => emailP(p) === email && ["pagado", "reembolsado", "pago_pendiente"].includes(p.status));
      const tk = hvals(await cmd(["HGETALL", "tickets"])).filter((t) => lc(t.email) === email);
      const month = A.monthKey(Date.now());
      return res.status(200).json({
        email,
        orders: mine.map((p) => ({ at: p.paidAt || p.created, kind: p.kind, status: p.status, total: p.paid != null ? p.paid : (p.price || 0) + (p.ship || 0), lines: (p.lines || []).map((l) => l.n + " × " + l.q), box: p.boxName || "" })).slice(0, 100),
        spins: tk.map((t) => ({ token: t.token, at: t.created, box: t.boxName, status: t.status, prize: t.prize ? t.prize.name : null, ship: t.ship })).sort((a, b) => b.at - a.at).slice(0, 100),
        month, entries: mine.filter((p) => p.status === "pagado" && A.monthKey(p.paidAt || p.created) === month).length,
      });
    }

    // ---------- Sorteo mensual (público) ----------
    if (b.action === "gw") {
      const cfg = await getCfg(), month = A.monthKey(Date.now()), ents = await entries(month);
      return res.status(200).json({
        on: !!cfg.on, title: cfg.title, desc: cfg.desc, img: cfg.iv ? imgUrl("gw", cfg.iv) : null, month, endsAt: A.monthEnd(month),
        participants: ents.length,
        winners: (await winners()).slice(0, 12).map((w) => ({ month: w.month, name: A.shortName(w.name), prize: w.prize })),
      });
    }

    // ---------- Sorteo mensual (administrador) ----------
    if (String(b.action).startsWith("admin_")) {
      const bad = await checkPin(req, b.pin);
      if (bad) return fail(res, bad.code, bad.error);
      if (b.action === "admin_gw") {
        const now = A.monthKey(Date.now()), d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
        const prev = A.monthKey(d.getTime());
        return res.status(200).json({ cfg: { ...(await getCfg()), img: (await getCfg()).iv ? imgUrl("gw", (await getCfg()).iv) : null }, months: { [now]: await entries(now), [prev]: await entries(prev) }, current: now, previous: prev, winners: await winners() });
      }
      if (b.action === "admin_gw_save") {
        const c = b.cfg || {}, cur = await getCfg();
        const cfg = { on: c.on ? 1 : 0, title: String(c.title || "").trim().slice(0, 120), desc: String(c.desc || "").trim().slice(0, 400), iv: cur.iv || null };
        if (cfg.on && !cfg.title) return fail(res, 400, "Escribe qué carta se sortea este mes");
        if (c.img) { checkImg(c.img); cfg.iv = await putImg("gw", c.img); } else if (c.rmImg) { await delImg("gw"); cfg.iv = null; }
        await cmd(["SET", "gw:cfg", JSON.stringify(cfg)]);
        return res.status(200).json({ ok: true });
      }
      if (b.action === "admin_gw_draw") {
        const month = String(b.month || "");
        if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, 400, "Mes no válido");
        const prevW = parse((await cmd(["HMGET", "gw:win", month]))[0]);
        if (prevW && !b.redo) return fail(res, 409, "Este mes ya tiene ganador: " + A.shortName(prevW.name));
        const ents = await entries(month), total = ents.reduce((s, e) => s + e.n, 0);
        if (!total) return fail(res, 409, "No hay participaciones en ese mes");
        const rnd = crypto.randomInt(0, total);
        let acc = 0, win = ents[ents.length - 1];
        for (const e of ents) { acc += e.n; if (rnd < acc) { win = e; break; } }
        const cfg = await getCfg();
        const w = { month, email: win.email, name: win.name, n: win.n, at: Date.now(), rnd, total, participants: ents.length, prize: cfg.title || "Carta Pokémon" };
        await cmd(["HSET", "gw:win", month, JSON.stringify(w)]);
        await cmd(["LPUSH", "gw:log", JSON.stringify(w)]).catch(() => {});
        let mailed = false;
        try { await sendMail(win.email, "🎉 ¡Has ganado el sorteo de Poke Islas!", wrap(`<h2>¡Enhorabuena${win.name ? ", " + esc(A.shortName(win.name)) : ""}!</h2><p>Has ganado el sorteo del mes <b>${esc(month)}</b>: <b>${esc(w.prize)}</b>.</p><p>Responde a este correo o escríbenos por Instagram <b>@poke_islas</b> para coordinar el envío.</p>`)); mailed = true; } catch (_) {}
        return res.status(200).json({ ok: true, winner: { ...w, mailed } });
      }
    }
    return fail(res, 400, "Acción no válida");
  } catch (e) {
    const user = /^Imagen/.test(e.message || "");
    return fail(res, user ? 400 : 500, user ? e.message : "Error del servidor. Inténtalo de nuevo.");
  }
};
