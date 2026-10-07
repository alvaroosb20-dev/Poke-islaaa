const { cmd } = require("./_db");
const { shipTable } = require("./_site");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { items, zone } = req.body || {};
    const ENVIOS = await shipTable();
    const env = ENVIOS[zone];
    if (!env || !Array.isArray(items) || !items.length || items.length > 30) return res.status(400).json({ error: "Pedido no válido" });
    const ids = items.map((it) => it.id);
    if (!ids.every(Number.isSafeInteger)) return res.status(400).json({ error: "Pedido no válido" });
    const rows = await cmd(["HMGET", "products", ...ids.map(String)]);
    const prods = rows.filter(Boolean).map((x) => JSON.parse(x));
    const f = new URLSearchParams();
    f.append("mode", "payment");
    items.forEach((it, i) => {
      const p = prods.find((x) => x.id === it.id), q = parseInt(it.qty, 10);
      if (!p || !(q > 0) || q > p.s) throw new Error("Producto no disponible: " + (p ? p.n : it.id));
      f.append(`line_items[${i}][quantity]`, q);
      f.append(`line_items[${i}][price_data][currency]`, "eur");
      f.append(`line_items[${i}][price_data][unit_amount]`, p.pr);
      f.append(`line_items[${i}][price_data][product_data][name]`, p.n);
    });
    f.append("metadata[zone]", zone);
    f.append("metadata[items]", items.map((it) => it.id + ":" + parseInt(it.qty, 10)).join(","));
    f.append("shipping_address_collection[allowed_countries][0]", "ES");
    f.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
    f.append("shipping_options[0][shipping_rate_data][display_name]", "Envío " + env[0]);
    f.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", env[1]);
    f.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "eur");
    f.append("phone_number_collection[enabled]", "true");
    const base = "https://" + req.headers.host;
    f.append("success_url", base + "/?pago=ok");
    f.append("cancel_url", base + "/");
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: f,
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: (d.error && d.error.message) || "Error de Stripe" });
    res.status(200).json({ url: d.url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
