const PRODUCTOS = {
  1: { n: "Mega Dragonite ex SAR (PSA 10)", p: 14900, s: 1 },
  2: { n: "Mega Darkrai ex SAR (Nova 9.5)", p: 3900, s: 1 },
  3: { n: "Reshiram & Charizard GX (Nova 10)", p: 2900, s: 2 },
  4: { n: "Pokémon Sticker Collection 1996", p: 8900, s: 3 },
  5: { n: "Lote 50 cartas sueltas holo", p: 2500, s: 12 },
  7: { n: "Figuras Charizard y Pikachu", p: 3400, s: 6 },
  8: { n: "Álbum de stickers japonés", p: 1900, s: 20 },
};
const ENVIOS = { canarias: ["Canarias", 500], peninsula: ["Península", 650], baleares: ["Baleares", 850], ceutamelilla: ["Ceuta / Melilla", 1200] };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  try {
    const { items, zone } = req.body || {};
    const env = ENVIOS[zone];
    if (!env || !Array.isArray(items) || !items.length) return res.status(400).json({ error: "Pedido no válido" });
    const f = new URLSearchParams();
    f.append("mode", "payment");
    items.forEach((it, i) => {
      const p = PRODUCTOS[it.id], q = parseInt(it.qty, 10);
      if (!p || !(q > 0) || q > p.s) throw new Error("Producto no disponible");
      f.append(`line_items[${i}][quantity]`, q);
      f.append(`line_items[${i}][price_data][currency]`, "eur");
      f.append(`line_items[${i}][price_data][unit_amount]`, p.p);
      f.append(`line_items[${i}][price_data][product_data][name]`, p.n);
    });
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
    if (!r.ok) return res.status(500).json({ error: d.error?.message || "Error de Stripe" });
    res.status(200).json({ url: d.url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

