import { ReturnApprovedEvent } from "../../domain/events/notification.events.js";
import { escapeEmailHtml } from "../../../../shared/messaging/email-content.js";

export function renderReturnApprovedTemplate(event: ReturnApprovedEvent): string {

  return `
<!DOCTYPE html>
<html lang="pt-BR">
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
                <p style="margin: 0; color: #1a1a1a; font-size: 16px; font-weight: 600;">#${escapeEmailHtml(event.orderId)}</p>
              </div>
              <div style="margin-bottom: 16px;">
                <p style="margin: 0 0 8px 0; color: #999; font-size: 12px; font-weight: 500; text-transform: uppercase;">Solicitação de Devolução</p>
                <p style="margin: 0; color: #1a1a1a; font-size: 16px; font-weight: 600;">#${escapeEmailHtml(event.returnId)}</p>
              </div>
              ${
                event.refundAmount
                  ? `
              <div>
                <p style="margin: 0 0 8px 0; color: #999; font-size: 12px; font-weight: 500; text-transform: uppercase;">Valor a Reembolsar</p>
                <p style="margin: 0; color: #1a1a1a; font-size: 16px; font-weight: 600;">${escapeEmailHtml(event.refundAmount)}</p>
              </div>
              `
                  : ""
              }
            </td>
          </tr>

          <!-- Info Box -->
          <tr>
            <td style="padding: 20px; background-color: #f0f8ff; border-radius: 6px; margin: 24px 20px 0 20px;">
              <p style="margin: 0; color: #1a1a1a; font-size: 14px; line-height: 1.5;">A aprovação da devolução não confirma que o reembolso foi concluído. Consulte o atendimento da loja para conferir as próximas etapas e, quando aplicável, as instruções de envio. O prazo de crédito depende da forma de pagamento e da instituição responsável.</p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 32px 20px; text-align: center; border-top: 1px solid #f0f0f0;">
              <p style="margin:0;color:#666;font-size:14px;line-height:1.6;">Para acompanhar a solicitação, volte à loja e abra o atendimento relacionado ao pedido.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 20px; border-top: 1px solid #f0f0f0; text-align: center; color: #999; font-size: 12px;">
              <p style="margin: 0;">Este é um e-mail automático. Por favor, não responda.</p>
              <p style="margin: 8px 0 0 0;">Se precisar de ajuda, use o atendimento disponível na loja.</p>
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
