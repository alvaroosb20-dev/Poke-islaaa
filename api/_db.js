// Acceso a la base de datos (Upstash Redis de Vercel) y catálogo de productos.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function cmd(args) {
  if (!URL_ || !TOKEN) throw new Error("Falta conectar la base de datos (Storage) en Vercel");
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const d = await r.json().catch(() => ({ error: "Respuesta no válida de la base de datos" }));
  if (!r.ok || d.error) throw new Error(d.error || "Error de base de datos");
  return d.result;
}

const parse = (x) => { try { return typeof x === "string" ? JSON.parse(x) : x; } catch (_) { return null; } };

// Convierte la respuesta de HGETALL (lista plana o pares) en un array de objetos
function hvals(raw) {
  const out = [];
  if (Array.isArray(raw)) for (let i = 0; i < raw.length; i += 2) { const o = parse(raw[i + 1]); if (o) out.push(o); }
  else if (raw && typeof raw === "object") for (const v of Object.values(raw)) { const o = parse(v); if (o) out.push(o); }
  return out;
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

const sortProducts = (l) => {
  const o = (p) => (Number.isFinite(p.ord) ? p.ord : 1e9);
  return l.sort((a, b) => o(a) - o(b) || a.id - b.id);
};

async function getAll() {
  let list = hvals(await cmd(["HGETALL", "products"]));
  if (!list.length && (await cmd(["SET", "seeded", "1", "NX"])) === "OK") {
    await cmd(["HSET", "products", ...SEED.flatMap((p) => [String(p.id), JSON.stringify(p)])]);
    list = SEED.map((p) => ({ ...p }));
  }
  // Limpieza única de las cajas antiguas guardadas como productos
  if ((await cmd(["SET", "mb_removed", "1", "NX"])) === "OK") {
    await cmd(["HDEL", "products", "101", "102", "103"]);
    list = list.filter((p) => ![101, 102, 103].includes(p.id));
  }
  // Migración: fotos que estaban dentro del producto pasan al almacén de imágenes
  const { putImg } = require("./_img");
  for (const p of list) {
    if (typeof p.img === "string" && p.img.startsWith("data:image/")) {
      try {
        const iv = await putImg("p" + p.id, p.img);
        const { img, ...rest } = p;
        await cmd(["HSET", "products", String(p.id), JSON.stringify({ ...rest, iv })]);
        p.iv = iv; delete p.img;
      } catch (e) { console.error("migración foto producto", p.id, e.message); } // la foto sigue guardada en el producto
    } else delete p.img;
  }
  // Recuperación única: fotos que sí están en el almacén pero que un guardado antiguo desenlazó del producto
  if (list.some((p) => !p.iv && !p.img) && (await cmd(["SET", "imgrec:1", "1", "NX"])) === "OK") {
    for (const p of list) {
      if (p.iv || p.img) continue;
      if (Number(await cmd(["EXISTS", "img:p" + p.id])) === 1) {
        p.iv = Date.now();
        const raw = parse((await cmd(["HMGET", "products", String(p.id)]))[0]);
        if (raw && !raw.iv) await cmd(["HSET", "products", String(p.id), JSON.stringify({ ...raw, iv: p.iv })]);
      }
    }
  }
  return sortProducts(list);
}

module.exports = { cmd, parse, hvals, getAll, sortProducts };
