// Llamadas a la API de Stripe desde el servidor (la clave secreta nunca llega al navegador).
async function stripe(method, path, params, idempotencyKey) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Falta configurar STRIPE_SECRET_KEY en Vercel");
  const headers = { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY };
  let body;
  if (params) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = params instanceof URLSearchParams ? params : new URLSearchParams(params); }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const r = await fetch("https://api.stripe.com/v1/" + path, { method, headers, body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((d.error && d.error.message) || "Error de Stripe");
    err.stripe = true;
    throw err;
  }
  return d;
}

const SESSION = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

// Datos de envío de una sesión de Checkout (cambian de sitio según la versión de la API)
function customer(s) {
  const cd = s.customer_details || {};
  const sh = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || {};
  const a = sh.address || cd.address || {};
  return {
    email: cd.email || "", name: sh.name || cd.name || "", phone: cd.phone || "",
    address: [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.state].filter(Boolean).join(", "),
  };
}

module.exports = { stripe, SESSION, customer };
