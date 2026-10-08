const crypto = require("crypto");
const { cmd, parse } = require("./_db");
const { shipTable, getMaint, MAINT_MSG } = require("./_site");
const { stripe } = require("./_stripe");
const { setPurchase } = require("./_orders");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  res.setHeader("Cache-Control", "no-store");
  try {
    if ((await getMaint()).on) return res.status(503).json({ error: MAINT_MSG });
    const { items, zone, nonce } = req.body || {};
    const ENVIOS = await shipTable();
    const env = ENVIOS[zone];
    if (!env) return res.status(400).json({ error: "Elige una zona de envío válida" });
    if (!Array.isArray(items) || !items.length || items.length > 30) return res.status(400).json({ error: "El carrito está vacío o no es válido" });
    // Se agrupan cantidades del mismo producto y se validan
    const qty = {};
    for (const it of items) {
      const id = Number(it && it.id), q = parseInt(it && it.qty, 10);
      if (!Number.isSafeInteger(id) || !(q > 0) || q > 50) return res.status(400).json({ error: "Pedido no válido" });
      qty[id] = (qty[id] || 0) + q;
    }
    const ids = Object.keys(qty);
    const rows = await cmd(["HMGET", "products", ...ids]);
    const f = new URLSearchParams();
    f.append("mode", "payment");
    let i = 0, subtotal = 0;
    const lines = [];
    for (const [k, row] of ids.map((k, j) => [k, rows[j]])) {
      const p = parse(row);
      if (!p) return res.status(409).json({ error: "Un producto del carrito ya no existe. Quítalo y vuelve a intentarlo." });
      if (qty[k] > p.s) return res.status(409).json({ error: p.s > 0 ? `Solo quedan ${p.s} de «${p.n}»` : `«${p.n}» está agotado` });
      // Precio y nombre salen de la base de datos, nunca del navegador
      f.append(`line_items[${i}][quantity]`, String(qty[k]));
      f.append(`line_items[${i}][price_data][currency]`, "eur");
      f.append(`line_items[${i}][price_data][unit_amount]`, String(p.pr));
      f.append(`line_items[${i}][price_data][product_data][name]`, p.n);
      subtotal += p.pr * qty[k];
      lines.push({ id: p.id, n: p.n, q: qty[k], pr: p.pr });
      i++;
    }
    f.append("metadata[kind]", "tienda");
    f.append("metadata[zone]", zone);
    f.append("metadata[items]", ids.map((k) => k + ":" + qty[k]).join(","));
    f.append("shipping_address_collection[allowed_countries][0]", "ES");
    f.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
    f.append("shipping_options[0][shipping_rate_data][display_name]", "Envío " + env[0]);
    f.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(env[1]));
    f.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "eur");
    f.append("phone_number_collection[enabled]", "true");
    const base = "https://" + req.headers.host;
    f.append("success_url", base + "/?pago={CHECKOUT_SESSION_ID}");
    f.append("cancel_url", base + "/?cancelado={CHECKOUT_SESSION_ID}");
    const key = /^[a-z0-9]{8,40}$/i.test(String(nonce || "")) ? nonce : crypto.randomBytes(8).toString("hex");
    const s = await stripe("POST", "checkout/sessions", f, "shop_" + key);
    await setPurchase(s.id, { kind: "tienda", lines, price: subtotal, ship: env[1], zone, status: "pendiente" }, "compra");
    res.status(200).json({ url: s.url });
  } catch (e) {
    res.status(e.stripe ? 400 : 500).json({ error: e.stripe ? e.message : "No se pudo iniciar el pago. Inténtalo de nuevo." });
  }
};
