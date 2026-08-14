import { OrderConfirmationEvent } from "../../domain/events/notification.events.js";

export function renderOrderConfirmationTemplate(event: OrderConfirmationEvent): string {
  const baseUrl = process.env.STOREFRONT_URL || "https://app.zyon.com.br";
  const merchantLogoUrl = `${baseUrl}/merchant/${event.merchantId}/logo`;

  const itemsHtml = event.items
    .map(
      (item) => `
    <tr style="border-bottom: 1px solid #f0f0f0;">
      <td style="padding: 12px 0; color: #1a1a1a; font-size: 14px;">${item.name}</td>
      <td style="padding: 12px 0; color: #1a1a1a; font-size: 14px; text-align: right;">x${item.quantity}</td>
      <td style="padding: 12px 0; color: #1a1a1a; font-size: 14px; text-align: right; font-weight: 600;">${item.price}</td>
    </tr>
  `,
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif; background-color: #fafafa;">
  <table cellpadding="0" cellspacing="0" style="width: 100%; background-color: #fafafa;">
    <tr>
      <td style="padding: 40px 20px;">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 20px; border-bottom: 1px solid #f0f0f0;">
              <h1 style="margin: 0; color: #1a1a1a; font-size: 24px; font-weight: 700;">Pedido Confirmado</h1>
              <p style="margin: 8px 0 0 0; color: #666; font-size: 14px;">Obrigado pela sua compra!</p>
            </td>
          </tr>

          <!-- Order Details -->
          <tr>
            <td style="padding: 24px 20px; border-bottom: 1px solid #f0f0f0;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px;">
                <span style="color: #666; font-size: 13px; font-weight: 500;">PEDIDO</span>
                <span style="color: #1a1a1a; font-size: 16px; font-weight: 600;">#${event.orderNumber}</span>
              </div>
            </td>
          </tr>

          <!-- Items Table -->
          <tr>
            <td style="padding: 24px 20px; border-bottom: 1px solid #f0f0f0;">
              <table cellpadding="0" cellspacing="0" style="width: 100%;">
                <thead>
                  <tr style="border-bottom: 2px solid #f0f0f0;">
                    <th style="text-align: left; padding: 0 0 12px 0; color: #999; font-size: 12px; font-weight: 600; text-transform: uppercase;">Produto</th>
                    <th style="text-align: right; padding: 0 0 12px 0; color: #999; font-size: 12px; font-weight: 600; text-transform: uppercase;">Qtd</th>
                    <th style="text-align: right; padding: 0 0 12px 0; color: #999; font-size: 12px; font-weight: 600; text-transform: uppercase;">Preço</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Total -->
          <tr>
            <td style="padding: 24px 20px; border-bottom: 1px solid #f0f0f0;">
              <div style="display: flex; justify-content: flex-end; gap: 20px; align-items: baseline;">
                <span style="color: #666; font-size: 14px;">Total:</span>
                <span style="color: #1a1a1a; font-size: 24px; font-weight: 700;">${event.total}</span>
              </div>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 32px 20px; text-align: center;">
              <a href="${baseUrl}/orders/${event.orderId}" style="display: inline-block; background-color: #2563eb; color: #fff; padding: 12px 32px; border-radius: 6px; font-weight: 600; font-size: 14px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.5px;">Acompanhar Pedido</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 20px; border-top: 1px solid #f0f0f0; text-align: center; color: #999; font-size: 12px;">
              <p style="margin: 0;">Este é um e-mail automático. Por favor, não responda.</p>
              <p style="margin: 8px 0 0 0;">Qualquer dúvida, acesse nosso <a href="${baseUrl}/support" style="color: #2563eb; text-decoration: none;">suporte</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
