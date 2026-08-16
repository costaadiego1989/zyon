import { OrderDeliveredEvent } from "../../domain/events/notification.events.js";

export function renderOrderDeliveredTemplate(event: OrderDeliveredEvent): string {
  const baseUrl = process.env.STOREFRONT_URL || "https://app.zyon.com.br";
  const brandColor = "#10b981";
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pedido Entregue</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb; -webkit-font-smoothing: antialiased;">
  <table cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb;">
    <tr>
      <td style="padding: 48px 20px;">
        <table cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);">

          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, ${brandColor}, #059669); padding: 40px 32px; text-align: center;">
              <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 56px; font-size: 28px;">📬</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">Pedido Entregue!</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Seu pedido chegou ao destino</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 32px 0;">
              <p style="margin: 0; color: #1f2937; font-size: 15px; line-height: 1.6;">
                Olá${event.buyerName ? ` <strong>${event.buyerName}</strong>` : ""},
              </p>
              <p style="margin: 8px 0 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                Seu pedido foi entregue com sucesso! Esperamos que esteja tudo perfeito. Caso tenha algum problema, entre em contato conosco.
              </p>
            </td>
          </tr>

          <!-- Success Card -->
          <tr>
            <td style="padding: 24px 32px;">
              <table cellpadding="0" cellspacing="0" style="width: 100%; background: #ecfdf5; border: 1px solid #d1fae5; border-radius: 10px;">
                <tr>
                  <td style="padding: 20px 24px; text-align: center;">
                    <p style="margin: 0 0 8px; color: #065f46; font-size: 15px; font-weight: 600;">Sua compra foi concluída!</p>
                    <p style="margin: 0; color: #047857; font-size: 13px;">Gostou da experiência? Nos avalie para ajudar outros compradores.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Timeline (all complete) -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <table cellpadding="0" cellspacing="0" style="width: 100%;">
                <tr>
                  <td style="width: 33%; text-align: center;">
                    <div style="width: 32px; height: 32px; background: ${brandColor}; border-radius: 50%; margin: 0 auto 8px; line-height: 32px; color: white; font-size: 14px;">✓</div>
                    <p style="margin: 0; color: ${brandColor}; font-size: 11px; font-weight: 600;">Confirmado</p>
                  </td>
                  <td style="width: 33%; text-align: center;">
                    <div style="width: 32px; height: 32px; background: ${brandColor}; border-radius: 50%; margin: 0 auto 8px; line-height: 32px; color: white; font-size: 14px;">✓</div>
                    <p style="margin: 0; color: ${brandColor}; font-size: 11px; font-weight: 600;">Enviado</p>
                  </td>
                  <td style="width: 33%; text-align: center;">
                    <div style="width: 32px; height: 32px; background: ${brandColor}; border-radius: 50%; margin: 0 auto 8px; line-height: 32px; color: white; font-size: 14px;">✓</div>
                    <p style="margin: 0; color: ${brandColor}; font-size: 11px; font-weight: 600;">Entregue</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Buttons -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              <a href="${baseUrl}/orders/${event.orderId}/review" style="display: inline-block; background-color: ${brandColor}; color: #ffffff; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; margin-right: 8px;">⭐ Avaliar Compra</a>
              <a href="${baseUrl}/orders/${event.orderId}" style="display: inline-block; background-color: #f3f4f6; color: #374151; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none;">Ver Pedido</a>
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

export function renderOrderDeliveredWhatsApp(event: OrderDeliveredEvent & { merchantName?: string }): string {
  const storeName = event.merchantName || "nossa loja";
  return [
    `📬 *Pedido Entregue!*`,
    ``,
    `Olá${event.buyerName ? ` ${event.buyerName}` : ""}! Seu pedido da *${storeName}* foi entregue com sucesso.`,
    ``,
    `✅ Esperamos que esteja tudo perfeito!`,
    ``,
    `Se gostou, nos avalie — sua opinião ajuda outros compradores. ⭐`,
    ``,
    `Caso tenha qualquer problema com o pedido, entre em contato conosco. Estamos aqui pra ajudar! 💬`,
  ].join("\n");
}
