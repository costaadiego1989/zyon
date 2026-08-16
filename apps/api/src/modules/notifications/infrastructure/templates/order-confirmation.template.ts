import { OrderConfirmationEvent } from "../../domain/events/notification.events.js";

export function renderOrderConfirmationTemplate(event: OrderConfirmationEvent): string {
  const baseUrl = process.env.STOREFRONT_URL || "https://app.zyon.com.br";
  const brandColor = "#10b981";
  const year = new Date().getFullYear();

  const itemsHtml = event.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 14px 0; border-bottom: 1px solid #f3f4f6; color: #1f2937; font-size: 14px; line-height: 1.4;">
        <strong>${item.name}</strong>
      </td>
      <td style="padding: 14px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px; text-align: center; width: 60px;">×${item.quantity}</td>
      <td style="padding: 14px 0; border-bottom: 1px solid #f3f4f6; color: #1f2937; font-size: 14px; text-align: right; font-weight: 600; white-space: nowrap;">${item.price}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pedido Confirmado</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb; -webkit-font-smoothing: antialiased;">
  <table cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb;">
    <tr>
      <td style="padding: 48px 20px;">
        <table cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);">

          <!-- Success Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, ${brandColor}, #059669); padding: 40px 32px; text-align: center;">
              <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 56px; font-size: 28px;">✓</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">Pedido Confirmado!</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Recebemos seu pagamento com sucesso</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 32px 0;">
              <p style="margin: 0; color: #1f2937; font-size: 15px; line-height: 1.6;">
                Olá${event.buyerName ? ` <strong>${event.buyerName}</strong>` : ""},
              </p>
              <p style="margin: 8px 0 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                Seu pedido <strong>#${event.orderNumber}</strong> foi confirmado e já está sendo preparado. Você receberá uma notificação quando ele for enviado.
              </p>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding: 24px 32px;">
              <p style="margin: 0 0 12px; color: #6b7280; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Itens do Pedido</p>
              <table cellpadding="0" cellspacing="0" style="width: 100%;">
                ${itemsHtml}
              </table>
            </td>
          </tr>

          <!-- Total -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <table cellpadding="0" cellspacing="0" style="width: 100%; background: #f9fafb; border-radius: 8px; padding: 16px;">
                <tr>
                  <td style="padding: 16px; text-align: right;">
                    <span style="color: #6b7280; font-size: 14px; margin-right: 16px;">Total:</span>
                    <span style="color: #1f2937; font-size: 24px; font-weight: 700;">${event.total}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              <a href="${baseUrl}/orders/${event.orderId}" style="display: inline-block; background-color: ${brandColor}; color: #ffffff; padding: 14px 36px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; letter-spacing: 0.2px;">Acompanhar Pedido</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background: #f9fafb; border-top: 1px solid #f3f4f6; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">Este é um e-mail automático. Não responda.</p>
              <p style="margin: 6px 0 0; color: #9ca3af; font-size: 12px;">© ${year} • Powered by Zyon</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── WhatsApp Template ──────────────────────────────────────────────────────

export function renderOrderConfirmationWhatsApp(event: OrderConfirmationEvent & { merchantName?: string }): string {
  const storeName = event.merchantName || "nossa loja";
  const itemsList = event.items
    .map((item) => `  • ${item.name} ×${item.quantity} — ${item.price}`)
    .join("\n");

  return [
    `✅ *Pedido Confirmado!*`,
    ``,
    `Olá${event.buyerName ? ` ${event.buyerName}` : ""}! Seu pagamento foi aprovado na *${storeName}*.`,
    ``,
    `📋 *Pedido #${event.orderNumber}*`,
    itemsList,
    ``,
    `💰 *Total: ${event.total}*`,
    ``,
    `Estamos preparando seu pedido. Você receberá uma notificação quando for enviado.`,
    ``,
    `Qualquer dúvida, estamos à disposição! 🙏`,
  ].join("\n");
}
