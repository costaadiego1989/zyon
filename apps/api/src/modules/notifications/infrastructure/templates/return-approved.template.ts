import { ReturnApprovedEvent } from "../../domain/events/notification.events.js";

export function renderReturnApprovedTemplate(event: ReturnApprovedEvent): string {
  const baseUrl = process.env.STOREFRONT_URL || "https://app.zyon.com.br";

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
              <h1 style="margin: 0; color: #1a1a1a; font-size: 24px; font-weight: 700;">Devolução Aprovada</h1>
              <p style="margin: 8px 0 0 0; color: #666; font-size: 14px;">Sua solicitação foi processada com sucesso</p>
            </td>
          </tr>

          <!-- Return Details -->
          <tr>
            <td style="padding: 24px 20px; border-bottom: 1px solid #f0f0f0;">
              <div style="margin-bottom: 16px;">
                <p style="margin: 0 0 8px 0; color: #999; font-size: 12px; font-weight: 500; text-transform: uppercase;">Pedido Original</p>
                <p style="margin: 0; color: #1a1a1a; font-size: 16px; font-weight: 600;">#${event.orderId}</p>
              </div>
              <div style="margin-bottom: 16px;">
                <p style="margin: 0 0 8px 0; color: #999; font-size: 12px; font-weight: 500; text-transform: uppercase;">Solicitação de Devolução</p>
                <p style="margin: 0; color: #1a1a1a; font-size: 16px; font-weight: 600;">#${event.returnId}</p>
              </div>
              ${
                event.refundAmount
                  ? `
              <div>
                <p style="margin: 0 0 8px 0; color: #999; font-size: 12px; font-weight: 500; text-transform: uppercase;">Valor a Reembolsar</p>
                <p style="margin: 0; color: #1a1a1a; font-size: 16px; font-weight: 600;">${event.refundAmount}</p>
              </div>
              `
                  : ""
              }
            </td>
          </tr>

          <!-- Info Box -->
          <tr>
            <td style="padding: 20px; background-color: #f0f8ff; border-radius: 6px; margin: 24px 20px 0 20px;">
              <p style="margin: 0; color: #1a1a1a; font-size: 14px; line-height: 1.5;">O valor será reembolsado para a mesma forma de pagamento em até 5-7 dias úteis. Você receberá uma notificação quando o reembolso for processado.</p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 32px 20px; text-align: center; border-top: 1px solid #f0f0f0;">
              <a href="${baseUrl}/returns/${event.returnId}" style="display: inline-block; background-color: #2563eb; color: #fff; padding: 12px 32px; border-radius: 6px; font-weight: 600; font-size: 14px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.5px;">Ver Devolução</a>
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
