import { OrderShippedEvent } from "../../domain/events/notification.events.js";

export function renderOrderShippedTemplate(event: OrderShippedEvent): string {
  const baseUrl = process.env.STOREFRONT_URL || "https://app.zyon.com.br";
  const brandColor = "#2563eb";
  const year = new Date().getFullYear();
  const trackingUrl = event.trackingNumber
    ? `https://melhorrastreio.com.br/rastreio/${event.trackingNumber}`
    : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pedido Enviado</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb; -webkit-font-smoothing: antialiased;">
  <table cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb;">
    <tr>
      <td style="padding: 48px 20px;">
        <table cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);">

          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, ${brandColor}, #1d4ed8); padding: 40px 32px; text-align: center;">
              <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 56px; font-size: 28px;">🚀</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">Pedido Enviado!</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Seu pedido está a caminho</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 32px 0;">
              <p style="margin: 0; color: #1f2937; font-size: 15px; line-height: 1.6;">
                Olá${event.buyerName ? ` <strong>${event.buyerName}</strong>` : ""},
              </p>
              <p style="margin: 8px 0 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                Ótima notícia! Seu pedido foi despachado e está a caminho do endereço de entrega.
              </p>
            </td>
          </tr>

          <!-- Tracking Info Card -->
          <tr>
            <td style="padding: 24px 32px;">
              <table cellpadding="0" cellspacing="0" style="width: 100%; background: #eff6ff; border: 1px solid #dbeafe; border-radius: 10px;">
                <tr>
                  <td style="padding: 20px 24px;">
                    ${event.trackingNumber ? `
                    <p style="margin: 0 0 4px; color: #6b7280; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Código de Rastreio</p>
                    <p style="margin: 0 0 16px; color: #1e40af; font-size: 18px; font-weight: 700; font-family: 'Courier New', monospace; letter-spacing: 1px;">${event.trackingNumber}</p>
                    ` : ""}
                    ${event.carrier ? `
                    <p style="margin: 0 0 4px; color: #6b7280; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Transportadora</p>
                    <p style="margin: 0 0 16px; color: #1f2937; font-size: 14px;">${event.carrier}</p>
                    ` : ""}
                    ${event.estimatedDelivery ? `
                    <p style="margin: 0 0 4px; color: #6b7280; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Previsão de Entrega</p>
                    <p style="margin: 0; color: #1f2937; font-size: 14px; font-weight: 600;">${event.estimatedDelivery}</p>
                    ` : ""}
                    ${!event.trackingNumber && !event.carrier && !event.estimatedDelivery ? `
                    <p style="margin: 0; color: #4b5563; font-size: 14px;">Em breve você receberá o código de rastreio para acompanhar a entrega.</p>
                    ` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              ${trackingUrl ? `
              <a href="${trackingUrl}" style="display: inline-block; background-color: ${brandColor}; color: #ffffff; padding: 14px 36px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; letter-spacing: 0.2px;">Rastrear Entrega</a>
              ` : `
              <a href="${baseUrl}/orders/${event.orderId}" style="display: inline-block; background-color: ${brandColor}; color: #ffffff; padding: 14px 36px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; letter-spacing: 0.2px;">Ver Pedido</a>
              `}
            </td>
          </tr>

          <!-- Timeline -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <table cellpadding="0" cellspacing="0" style="width: 100%;">
                <tr>
                  <td style="width: 33%; text-align: center;">
                    <div style="width: 32px; height: 32px; background: #10b981; border-radius: 50%; margin: 0 auto 8px; line-height: 32px; color: white; font-size: 14px;">✓</div>
                    <p style="margin: 0; color: #10b981; font-size: 11px; font-weight: 600;">Confirmado</p>
                  </td>
                  <td style="width: 33%; text-align: center;">
                    <div style="width: 32px; height: 32px; background: ${brandColor}; border-radius: 50%; margin: 0 auto 8px; line-height: 32px; color: white; font-size: 14px;">📦</div>
                    <p style="margin: 0; color: ${brandColor}; font-size: 11px; font-weight: 600;">Enviado</p>
                  </td>
                  <td style="width: 33%; text-align: center;">
                    <div style="width: 32px; height: 32px; background: #e5e7eb; border-radius: 50%; margin: 0 auto 8px; line-height: 32px; color: #9ca3af; font-size: 14px;">🏠</div>
                    <p style="margin: 0; color: #9ca3af; font-size: 11px; font-weight: 600;">Entregue</p>
                  </td>
                </tr>
              </table>
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

export function renderOrderShippedWhatsApp(event: OrderShippedEvent & { merchantName?: string }): string {
  const storeName = event.merchantName || "nossa loja";
  // Melhor Rastreio works for all carriers contracted via Melhor Envio
  const trackingUrl = event.trackingNumber
    ? `https://melhorrastreio.com.br/rastreio/${event.trackingNumber}`
    : null;

  const lines = [
    `🚀 *Pedido Enviado!*`,
    ``,
    `Olá${event.buyerName ? ` ${event.buyerName}` : ""}! Seu pedido da *${storeName}* foi despachado e está a caminho.`,
  ];

  if (event.trackingNumber) {
    lines.push(``);
    lines.push(`📦 *Código de rastreio:* \`${event.trackingNumber}\``);
    if (trackingUrl) {
      lines.push(`🔗 *Acompanhe aqui:* ${trackingUrl}`);
    }
  } else {
    lines.push(``);
    lines.push(`📦 Em breve você receberá o código de rastreio.`);
  }

  if (event.carrier) {
    lines.push(`🚛 Transportadora: ${event.carrier}`);
  }

  if (event.estimatedDelivery) {
    lines.push(`📅 Previsão de entrega: ${event.estimatedDelivery}`);
  }

  lines.push(``);
  lines.push(`Qualquer dúvida, estamos à disposição! 💬`);

  return lines.join("\n");
}
