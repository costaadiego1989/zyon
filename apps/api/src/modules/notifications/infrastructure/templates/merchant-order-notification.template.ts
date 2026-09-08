import type { OrderConfirmationEvent } from "../../domain/events/notification.events.js";

type MerchantOrderEvent = OrderConfirmationEvent & { merchantName: string };

export function renderMerchantOrderEmail(event: MerchantOrderEvent): string {
  const year = new Date().getFullYear();
  const total = formatCurrency(event.total, event.currency);
  const buyer = event.buyerName || event.buyerEmail || event.buyerPhone || "Cliente";
  const items = event.items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;line-height:1.45;"><strong>${escapeHtml(item.name)}</strong></td>
      <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#4b5563;font-size:13px;text-align:center;">x${item.quantity}</td>
      <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;text-align:right;font-weight:700;white-space:nowrap;">${formatCurrency(item.price, event.currency)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Novo pedido</title></head>
<body style="margin:0;padding:0;background:#f4f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f7f5;">
    <tr><td style="padding:36px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dbe5de;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:30px 30px 24px;background:#0f2f25;color:#f7fbf8;">
          <p style="margin:0 0 10px;color:#a7f3d0;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(event.merchantName)}</p>
          <h1 style="margin:0;font-size:24px;line-height:1.2;letter-spacing:-.02em;">Novo pedido recebido</h1>
          <p style="margin:10px 0 0;color:#d9efe5;font-size:14px;line-height:1.6;">Pedido <strong>#${escapeHtml(event.orderNumber)}</strong> confirmado por ${escapeHtml(buyer)}.</p>
        </td></tr>
        <tr><td style="padding:26px 30px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8faf9;border:1px solid #e3ebe6;border-radius:10px;">
            <tr>
              <td style="padding:18px 20px;"><span style="display:block;color:#64746b;font-size:12px;">Cliente</span><strong style="display:block;margin-top:4px;font-size:15px;">${escapeHtml(buyer)}</strong></td>
              <td style="padding:18px 20px;text-align:right;"><span style="display:block;color:#64746b;font-size:12px;">Total aprovado</span><strong style="display:block;margin-top:4px;font-size:20px;">${total}</strong></td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 30px 4px;">
          <p style="margin:0 0 8px;color:#64746b;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Itens</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${items}</table>
        </td></tr>
        <tr><td style="padding:22px 30px 30px;">
          <p style="margin:0;color:#4b5563;font-size:13px;line-height:1.6;">O pedido tambem aparece nas notificacoes do dashboard. Se o WhatsApp da loja estiver conectado, o aviso tambem e enviado por la.</p>
        </td></tr>
        <tr><td style="padding:18px 30px;background:#f8faf9;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">${year} Zyon - notificacao transacional automatica.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderMerchantOrderWhatsApp(event: MerchantOrderEvent): string {
  const buyer = event.buyerName || event.buyerEmail || event.buyerPhone || "Cliente";
  const items = event.items.map((item) => `- ${item.name} x${item.quantity} - ${formatCurrency(item.price, event.currency)}`).join("\n");
  return [
    `Novo pedido na *${event.merchantName}*`,
    "",
    `Pedido *#${event.orderNumber}* confirmado por ${buyer}.`,
    `Total: *${formatCurrency(event.total, event.currency)}*`,
    "",
    "*Itens*",
    items,
    "",
    "O pedido tambem foi registrado nas notificacoes do dashboard.",
  ].join("\n");
}

function formatCurrency(value: string, currency = "BRL") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char] ?? char));
}
