import type { EmailOtpContext } from "../domain/ports/email-otp.port.js";

function cleanMerchantName(name: string | undefined): string {
  return (typeof name === "string" ? name : "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 120) || "Zyon";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

/** Replace only the display name; the delivery mailbox always comes from configuration. */
export function buildEmailOtpFrom(configuredFrom: string, context?: EmailOtpContext): string {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(configuredFrom)) throw new Error("otp_email_sender_invalid");
  const configured = configuredFrom.trim();
  const namedMailbox = /^[^<>]*<([^<>]+)>$/.exec(configured);
  const mailbox = (namedMailbox?.[1] ?? configured).trim();
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(mailbox)) {
    throw new Error("otp_email_sender_invalid");
  }
  const merchantName = cleanMerchantName(context?.merchantName);
  const displayName = merchantName === "Zyon" ? "Zyon" : `${merchantName} via Zyon`;
  const quotedDisplayName = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${quotedDisplayName}" <${mailbox}>`;
}

export function buildEmailOtpMessage(code: string, context?: EmailOtpContext): { subject: string; text: string; html: string } {
  if (code.length !== 6 || !/^\d{6}$/.test(code)) throw new Error("otp_email_code_invalid");
  const merchantName = cleanMerchantName(context?.merchantName);
  const name = escapeHtml(merchantName);
  const subject = `${merchantName} · Seu código de acesso`;
  const text = `${merchantName}\n\nConfirme seu e-mail\n\nUse este código para continuar na ${merchantName}:\n\n${code}\n\nVálido por 10 minutos.\n\nVolte à loja e digite o código na tela de confirmação.\n\nNão solicitou este código? Você pode ignorar esta mensagem. Não compartilhe o código com outras pessoas.\n\nEnviado com segurança pela Zyon.`;
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f2f5f3;color:#17231d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Confirme seu e-mail para continuar na ${name}. Seu código é válido por 10 minutos.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f2f5f3;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dce5de;border-radius:16px;">
        <tr><td style="padding:28px 24px 24px;border-bottom:1px solid #e4eae6;">
          <p style="margin:0 0 8px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#426b54;">Acesso à sua conta</p>
          <p style="margin:0;font-size:20px;line-height:28px;font-weight:700;color:#17231d;overflow-wrap:anywhere;">${name}</p>
        </td></tr>
        <tr><td style="padding:30px 24px 28px;">
          <h1 style="margin:0 0 14px;font-size:28px;line-height:35px;font-weight:700;letter-spacing:-0.6px;color:#17231d;">Confirme seu e-mail</h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#4c5b52;overflow-wrap:anywhere;">Use o código abaixo para continuar na <strong style="color:#17231d;">${name}</strong>.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#eff6f1;border:1px solid #d5e5da;border-radius:12px;">
            <tr><td align="center" style="padding:22px 8px 10px;font-size:12px;line-height:18px;color:#426b54;font-weight:700;">SEU CÓDIGO DE ACESSO</td></tr>
            <tr><td align="center" style="padding:0 8px 12px;font-family:'Courier New',monospace;font-size:36px;line-height:44px;font-weight:700;letter-spacing:6px;color:#174b30;white-space:nowrap;">${code}</td></tr>
            <tr><td align="center" style="padding:0 12px 22px;font-size:13px;line-height:20px;color:#426b54;">Válido por <strong>10 minutos</strong></td></tr>
          </table>
          <p style="margin:22px 0 0;font-size:15px;line-height:24px;color:#4c5b52;">Volte à loja e digite o código na tela de confirmação.</p>
        </td></tr>
        <tr><td style="padding:22px 24px 26px;border-top:1px solid #e4eae6;">
          <p style="margin:0;font-size:13px;line-height:21px;color:#5c6a61;"><strong style="color:#36493d;">Não solicitou este código?</strong><br>Você pode ignorar esta mensagem. Não compartilhe o código com outras pessoas.</p>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;line-height:20px;color:#68776d;">Enviado com segurança pela <strong style="color:#36493d;">Zyon</strong>.</p>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}
