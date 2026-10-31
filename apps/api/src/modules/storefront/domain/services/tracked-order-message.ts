import { storefrontToolOutputSchemas } from "../contracts/storefront-tool-output.schemas.js";

const BEFORE_DISPATCH = new Set(["pending", "processing", "approved", "paid", "created", "label_generated"]);
const AFTER_DISPATCH = new Set(["dispatched", "in_transit", "out_for_delivery", "delivered", "returned"]);

/** Formats only the validated owned-handler projection. A selected carrier or
 * generated label does not prove handoff, and unavailable tracking is explicit. */
export function formatTrackedOrderMessage(value: unknown): string | undefined {
  const parsed = storefrontToolOutputSchemas.track_order.safeParse(value);
  if (!parsed.success) return undefined;
  const order = parsed.data;
  if (!order.found) return order.message;
  const lines = [`📦 *Pedido ${order.orderId}*`, order.status === "approved" || order.status === "paid"
    ? "💳 *Pagamento:* aprovado" : `📋 *Status:* ${order.statusLabel}`];
  if (order.carrier?.trim()) lines.push(`🚚 *${AFTER_DISPATCH.has(order.status) ? "Transportadora" : BEFORE_DISPATCH.has(order.status) ? "Frete selecionado" : "Frete cadastrado"}:* ${order.carrier.trim()}`);
  if (BEFORE_DISPATCH.has(order.status)) lines.push("📮 A postagem ainda não está confirmada.");
  const code = order.trackingCode?.trim();
  if (order.trackingAvailable && code && !code.startsWith("pending:")) {
    lines.push(`🔎 *Código de rastreio:* ${code}`);
    if (order.trackingUrl) {
      try { const url = new URL(order.trackingUrl); if (url.protocol === "https:" && !url.username && !url.password) lines.push(`🔗 ${url.href}`); }
      catch { /* Invalid links never become tracking evidence. */ }
    }
  } else lines.push("🔎 O código de rastreio ainda não está disponível.");
  return lines.join("\n\n");
}
