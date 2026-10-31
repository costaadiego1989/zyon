import type { OrderConfirmationEvent } from "../../domain/events/notification.events.js";
import { formatReceiptMoney, receiptSummaryLines } from "../../domain/paid-order-receipt.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export function receiptTotalLabel(event: OrderConfirmationEvent): string {
  return event.paidReceipt ? "Total pago" : "Valor do pedido";
}
export function receiptTotalFormatted(event: OrderConfirmationEvent): string {
  return event.paidReceipt ? formatReceiptMoney(event.paidReceipt.totalPaidCents, event.paidReceipt.currency)
    : `${event.currency ?? "BRL"} ${event.total}`;
}
export function renderReceiptSummaryHtml(event: OrderConfirmationEvent): string {
  const lines = event.paidReceipt ? receiptSummaryLines(event.paidReceipt)
    : [`Valor do pedido: ${receiptTotalFormatted(event)}`, "Total pago e taxas adicionais não discriminados neste recibo."];
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8faf9;border-radius:8px;">${lines.map(line => {
    const split = line.indexOf(": ");
    if (split < 0) return `<tr><td colspan="2" style="padding:10px 16px;color:#64746b;font-size:12px;">${escapeHtml(line)}</td></tr>`;
    const total = line.startsWith("Total pago:");
    return `<tr><td style="padding:8px 16px;color:#4b5563;font-size:14px;${total ? "font-weight:700;" : ""}">${escapeHtml(line.slice(0, split))}</td><td style="padding:8px 16px;text-align:right;color:#111827;font-size:${total ? "20" : "14"}px;${total ? "font-weight:700;" : ""}">${escapeHtml(line.slice(split + 2))}</td></tr>`;
  }).join("")}</table>`;
}
export function renderReceiptSummaryWhatsApp(event: OrderConfirmationEvent): string {
  const icons: Record<string, string> = { Produtos: "🛍️", Desconto: "🏷️", Frete: "🚚", "Taxa de serviço": "ℹ️" };
  return event.paidReceipt ? receiptSummaryLines(event.paidReceipt).map(line => line.startsWith("Total pago:") ? `\n✅ *${line}*`
    : `${icons[line.split(":")[0]!] ?? "ℹ️"} ${line}`).join("\n")
    : `💰 *Valor do pedido: ${receiptTotalFormatted(event)}*\nTotal pago e taxas adicionais não discriminados neste recibo.`;
}
