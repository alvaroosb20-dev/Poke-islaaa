// Llamada a Gemini con modelos de reserva: si uno no existe, no tiene cuota o tarda demasiado, prueba el siguiente.
const { cmd } = require("./_db");

const MODELS = () => [...new Set([process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"].map((m) => String(m || "").trim().replace(/^models\//, "")).filter(Boolean))];

async function call(model, body, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST", signal: ac.signal,
      headers: { "x-goog-api-key": String(process.env.GEMINI_API_KEY || "").trim(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, d };
  } catch (e) {
    return { status: 0, ok: false, d: { error: { message: e.name === "AbortError" ? "tardó demasiado" : e.message } } };
  } finally { clearTimeout(t); }
}

// Devuelve { text, model } o lanza un error con .code (401 clave, 429 cuota, 503 ocupado, 502 otro)
async function gemini(system, contents, opt) {
  opt = opt || {};
  if (!process.env.GEMINI_API_KEY) { const e = new Error("El asistente no está configurado (falta GEMINI_API_KEY en Vercel)."); e.code = 500; throw e; }
  const t0 = Date.now(), budget = opt.budget || 45000;
  let last = null;
  for (const model of MODELS()) {
    const left = budget - (Date.now() - t0);
    if (left < 4000) break;
    const r = await call(model, { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: opt.max || 4096, temperature: 0.5 } }, Math.min(25000, left));
    if (r.ok) {
      const c = r.d.candidates && r.d.candidates[0];
      const text = ((c && c.content && c.content.parts) || []).map((p) => (p.thought ? "" : p.text || "")).join("\n").trim();
      if (text) { cmd(["SET", "ai:ok", JSON.stringify({ at: Date.now(), model })]).catch(() => {}); return { text, model }; }
      last = { status: 200, msg: "respuesta vacía" + (c && c.finishReason ? " (" + c.finishReason + ")" : "") };
      if (c && c.finishReason === "SAFETY") break;
      continue;
    }
    const msg = ((r.d.error && r.d.error.message) || "sin detalle").slice(0, 200);
    last = { status: r.status, msg, model };
    // Clave inválida o sin permisos: no tiene sentido probar otros modelos
    if (r.status === 401 || (r.status === 403 && /API key|permission|PERMISSION_DENIED/i.test(msg) && !/model/i.test(msg)) || (r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg))) break;
  }
  cmd(["SET", "ai:err", JSON.stringify({ at: Date.now(), ...(last || {}) })]).catch(() => {});
  const e = new Error(last ? last.msg : "sin respuesta");
  e.code = !last ? 502 : last.status === 429 ? 429 : last.status === 503 || last.status === 0 ? 503 : (last.status === 400 && /API key/i.test(last.msg)) || last.status === 401 || last.status === 403 ? 401 : 502;
  e.detail = last;
  throw e;
}

module.exports = { gemini, MODELS };
