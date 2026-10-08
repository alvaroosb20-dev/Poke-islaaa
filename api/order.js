// Estado de un pago al volver de Stripe, y cancelación cuando el cliente abandona el pago.
const { stripe, SESSION } = require("./_stripe");
const { setPurchase, getPurchase } = require("./_orders");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  res.setHeader("Cache-Control", "no-store");
  const { action, session } = req.body || {};
  if (!SESSION.test(String(session || ""))) return res.status(400).json({ error: "Pago no válido" });
  try {
    let s = await stripe("GET", "checkout/sessions/" + session);
    if (action === "cancel") {
      // Se caduca la sesión para que ya no pueda pagarse más tarde
      if (s.status === "open") s = await stripe("POST", "checkout/sessions/" + session + "/expire", {});
      if (s.status === "expired") await setPurchase(session, { status: "cancelado" }, "cancelado por el cliente");
    }
    let status = "pendiente";
    if (s.payment_status === "paid" || s.payment_status === "no_payment_required") status = "pagado";
    else if (s.status === "expired") status = "cancelado";
    else if (s.status === "complete") status = "pago_pendiente";
    const p = await getPurchase(session);
    if (p && p.status === "pagado") status = "pagado";
    return res.status(200).json({ status, kind: (s.metadata && s.metadata.kind) || "tienda" });
  } catch (e) {
    return res.status(e.stripe ? 400 : 500).json({ error: e.stripe ? e.message : "No se pudo comprobar el pago" });
  }
};
