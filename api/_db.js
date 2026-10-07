const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function cmd(args) {
  if (!URL_ || !TOKEN) throw new Error("Falta conectar la base de datos (Storage) en Vercel");
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || "Error de base de datos");
  return d.result;
}

const SEED = [
  { id: 1, n: "Mega Dragonite ex SAR", c: "Cartas graduadas", g: "PSA 10", pr: 14900, o: 16900, s: 1, f: 1, i: "psa", h: "#f26b1d" },
  { id: 2, n: "Mega Darkrai ex SAR", c: "Cartas graduadas", g: "Nova 9.5", pr: 3900, s: 1, f: 1, i: "n1", h: "#ffcb05" },
  { id: 3, n: "Reshiram & Charizard GX", c: "Cartas graduadas", g: "Nova 10", pr: 2900, s: 2, f: 0, i: "n2", h: "#7a4fd1" },
  { id: 4, n: "Pokémon Sticker Collection 1996", c: "Álbumes vintage", g: "Japón", pr: 8900, s: 3, f: 1, i: "alb", h: "#c3302b" },
  { id: 5, n: "Lote 50 cartas sueltas holo", c: "Cartas sueltas", pr: 2500, s: 12, f: 0, i: "lot", h: "#1f7a5c" },
  { id: 6, n: "Lugia V Paradigm Trigger", c: "Cartas graduadas", g: "Nova 9.5", pr: 2400, o: 2900, s: 0, f: 0, i: "n3", h: "#2f8f2f" },
  { id: 7, n: "Figuras Charizard y Pikachu", c: "Figuras", pr: 3400, s: 6, f: 0, i: "fig", h: "#e2562a" },
  { id: 8, n: "Álbum de stickers japonés", c: "Stickers", pr: 1900, s: 20, f: 0, i: "stk", h: "#2a7de1" },
];

function toList(raw) {
  const out = [];
  if (Array.isArray(raw)) for (let k = 0; k < raw.length; k += 2) out.push(JSON.parse(raw[k + 1]));
  else if (raw && typeof raw === "object") for (const v of Object.values(raw)) out.push(typeof v === "string" ? JSON.parse(v) : v);
  const o = (p) => (p.ord == null ? 1e9 : p.ord);
  return out.sort((a, b) => o(a) - o(b) || a.id - b.id);
}

async function getAll() {
  let raw = await cmd(["HGETALL", "products"]);
  if ((!raw || !raw.length) && (await cmd(["SET", "seeded", "1", "NX"])) === "OK") {
    await cmd(["HSET", "products", ...SEED.flatMap((p) => [String(p.id), JSON.stringify(p)])]);
    raw = await cmd(["HGETALL", "products"]);
  }
  if ((await cmd(["SET", "mb_removed", "1", "NX"])) === "OK") {
    await cmd(["HDEL", "products", "101", "102", "103"]);
    raw = await cmd(["HGETALL", "products"]);
  }
  return toList(raw);
}

module.exports = { cmd, getAll };
