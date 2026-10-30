import { assertPaymentAmount, type PaymentAmountBreakdown } from "../../payment/domain/payment-amount.js";

/** Presentation of an approved charge; merchant accounting remains unchanged. */
export type PaidOrderReceipt = {
  status: "itemized";
  currency: string;
  itemsSubtotalCents: number;
  discountCents: number;
  shippingCents: number;
  platformFeeCents: number;
  merchantOrderTotalCents: number;
  totalPaidCents: number;
} | { status: "total_only"; currency: string; totalPaidCents: number; reason: "breakdown_unavailable" };

export interface ReceiptOrderSnapshot {
  merchantId: string; sessionId: string; externalOrderId: string; status: string;
  currency: string; orderTotal: unknown; shippingCents: number | null; lineItemsJson: unknown;
}
export interface ReceiptPaymentSnapshot {
  merchantId: string; sessionId: string; providerPaymentId: string | null; status: string;
  currency: string; amountCents: number; approvedAmountCents: number | null; amountBreakdown: unknown;
}

export function exactMajorCents(value: unknown): number | null {
  const text = String(value ?? "");
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!match || /[1-9]/.test((match[2] ?? "").slice(2))) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").slice(0, 2).padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function projectPaidOrderReceipt(order: ReceiptOrderSnapshot, payment: ReceiptPaymentSnapshot): PaidOrderReceipt | null {
  if (order.status !== "approved" || payment.status !== "approved" || !order.merchantId || !order.sessionId || !order.externalOrderId
    || payment.merchantId !== order.merchantId || payment.sessionId !== order.sessionId
    || payment.providerPaymentId !== order.externalOrderId || payment.currency !== order.currency
    || !/^[A-Z]{3}$/.test(payment.currency) || !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0
    || payment.approvedAmountCents !== payment.amountCents) return null;
  const totalOnly: PaidOrderReceipt = { status: "total_only", currency: payment.currency,
    totalPaidCents: payment.amountCents, reason: "breakdown_unavailable" };
  const breakdown = payment.amountBreakdown as PaymentAmountBreakdown | null;
  try {
    if (!breakdown || typeof breakdown !== "object") return totalOnly;
    assertPaymentAmount(breakdown, payment.amountCents, payment.currency);
    if (!Array.isArray(order.lineItemsJson) || !order.lineItemsJson.length) return totalOnly;
    let subtotal = 0;
    for (const line of order.lineItemsJson) {
      if (!line || typeof line !== "object" || !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0
        || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) return totalOnly;
      subtotal += line.unitPriceCents * line.quantity;
      if (!Number.isSafeInteger(subtotal)) return totalOnly;
    }
    const merchantOrderTotalCents = exactMajorCents(order.orderTotal);
    if (subtotal !== breakdown.itemsSubtotalCents || order.shippingCents !== breakdown.shippingCents
      || merchantOrderTotalCents !== breakdown.itemsSubtotalCents - breakdown.discountCents + breakdown.shippingCents) return totalOnly;
    return { status: "itemized", currency: payment.currency, itemsSubtotalCents: breakdown.itemsSubtotalCents,
      discountCents: breakdown.discountCents, shippingCents: breakdown.shippingCents,
      platformFeeCents: breakdown.platformFeeCents, merchantOrderTotalCents, totalPaidCents: payment.amountCents };
  } catch { return totalOnly; }
}

export function formatReceiptMoney(cents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export function receiptSummaryLines(receipt: PaidOrderReceipt): string[] {
  const money = (cents: number) => formatReceiptMoney(cents, receipt.currency);
  return receipt.status === "itemized" ? [
    `Produtos: ${money(receipt.itemsSubtotalCents)}`, `Desconto: −${money(receipt.discountCents)}`,
    `Frete: ${money(receipt.shippingCents)}`, `Taxa de serviço: ${money(receipt.platformFeeCents)}`,
    `Total pago: ${money(receipt.totalPaidCents)}`,
  ] : [`Total pago: ${money(receipt.totalPaidCents)}`, "Detalhamento de produtos, desconto, frete e taxas indisponível neste recibo."];
}
