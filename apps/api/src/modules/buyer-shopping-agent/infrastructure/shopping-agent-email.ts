import { cleanEmailSubject, escapeEmailHtml as escape } from "../../../shared/messaging/email-content.js";
import type { SendEmailInput } from "../../notifications/domain/ports/email-sender.port.js";
import type { ShoppingActivity } from "../domain/shopping-agent.js";

interface AgentEmailInput {
  buyerName: string;
  storeName: string;
  logoUrl?: string;
  link: string;
  activity: ShoppingActivity;
}

/** Base64 logos need a MIME attachment: Gmail does not render data: image sources. */
function emailLogo(raw?: string): { src?: string; attachments?: SendEmailInput["attachments"] } {
  if (!raw) return {};
  const data = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (data && data[2].length <= 2_800_000) {
    return { src: "cid:shopping-store-logo", attachments: [{ filename: `logo.${data[1] === "jpeg" ? "jpg" : data[1]}`,
      content: data[2], contentType: `image/${data[1]}`, contentId: "shopping-store-logo" }] };
  }
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && !url.username && !url.password) return { src: url.href };
  } catch { /* A missing or invalid logo falls back to the store's name. */ }
  return {};
}

/** Preserve the verified sender mailbox while identifying the store in the inbox. */
export function shoppingAgentEmailFrom(configuredFrom: string, storeName: string): string {
  const mailbox = (/^[^<>]*<([^<>]+)>$/.exec(configuredFrom.trim())?.[1] ?? configuredFrom).trim();
  if (/[\r\n<>]/.test(mailbox) || !/^[^\s@]+@[^\s@]+$/.test(mailbox)) throw new Error("agent_email_sender_invalid");
  const name = cleanEmailSubject(storeName).slice(0, 120) || "Sua loja";
  return `"${(name + " via Zyon").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${mailbox}>`;
}

/** Table layout and inline styles keep the notification readable in mail clients. */
export function buildShoppingAgentEmail(input: AgentEmailInput): Pick<SendEmailInput, "subject" | "html" | "text" | "attachments"> {
  const url = new URL(input.link);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("agent_email_link_invalid");
  const link = escape(url.href), store = escape(input.storeName), buyer = escape(input.buyerName);
  const subject = cleanEmailSubject(`${input.storeName} | Novidades do seu agente pessoal`);
  const logo = emailLogo(input.logoUrl);
  const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const quote = input.activity.quote;
  const row = (label: string, value: string, total = false) => `<tr><td style="padding:${total ? "16px 0 0" : "6px 0"};${total ? "border-top:1px solid #dce5df;" : ""}font-size:${total ? "17" : "14"}px;line-height:22px;color:${total ? "#172b21" : "#52645a"};font-weight:${total ? "700" : "400"};">${escape(label)}</td><td align="right" style="padding:${total ? "16px 0 0" : "6px 0"};${total ? "border-top:1px solid #dce5df;" : ""}font-size:${total ? "21" : "14"}px;line-height:26px;color:#172b21;font-weight:${total ? "700" : "400"};white-space:nowrap;">${escape(value)}</td></tr>`;
  const summary = quote ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:28px 0 0;border-top:1px solid #e1e8e3;">
    <tr><td style="padding:24px 0 12px;font-size:16px;line-height:24px;font-weight:700;color:#172b21;">Resumo para sua revisão</td></tr>
    ${quote.items.map(item => `<tr><td style="padding:0 0 12px;font-size:15px;line-height:23px;color:#344b3e;overflow-wrap:anywhere;"><strong>${escape(item.name)}</strong><br><span style="font-size:13px;color:#52645a;">Quantidade: ${item.quantity} &middot; ${escape(money(item.unitPriceCents))} por unidade</span></td></tr>`).join("")}
    <tr><td style="padding:4px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${row("Produtos", money(quote.subtotalCents))}${quote.discountCents > 0 ? row("Desconto", `− ${money(quote.discountCents)}`) : ""}
    ${row("Frete", quote.shippingCents === null ? "A calcular no checkout" : quote.shippingCents === 0 ? "Sem custo" : money(quote.shippingCents))}
    ${quote.serviceFeeCents > 0 ? row("Taxa de serviço", money(quote.serviceFeeCents)) : ""}
    ${row(quote.shippingCents === null ? "Total sem frete" : "Total para revisar", money(quote.totalCents), true)}
    </table></td></tr>
    <tr><td style="padding:12px 0 0;font-size:12px;line-height:19px;color:#52645a;">Preço e disponibilidade serão confirmados ao abrir o checkout.</td></tr>
    </table>` : "";
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f2f5f3;color:#172b21;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Seu agente acompanhou a loja por você. Confira a atualização e revise sua tarefa.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f2f5f3;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:580px;background-color:#ffffff;border:1px solid #dce5df;border-radius:12px;">
      <tr><td style="padding:28px 24px;border-bottom:1px solid #e1e8e3;">
        ${logo.src ? `<img src="${escape(logo.src)}" alt="Logo de ${store}" height="48" style="display:block;height:48px;width:auto;max-width:180px;object-fit:contain;margin:0 0 16px;border:0;">` : ""}
        <p style="margin:0;font-size:19px;line-height:27px;font-weight:700;color:#172b21;overflow-wrap:anywhere;">${store}</p>
        <p style="margin:4px 0 0;font-size:13px;line-height:20px;color:#52645a;">Seu agente pessoal de compras</p>
      </td></tr>
      <tr><td style="padding:30px 24px 32px;">
        <h1 style="margin:0 0 20px;font-size:28px;line-height:35px;letter-spacing:-0.5px;color:#172b21;">Seu agente tem novidades.</h1>
        <p style="margin:0 0 12px;font-size:16px;line-height:25px;color:#344b3e;overflow-wrap:anywhere;">Olá, ${buyer}.</p>
        <p style="margin:0;font-size:16px;line-height:25px;color:#344b3e;overflow-wrap:anywhere;">${escape(input.activity.message).replace(/\n/g, "<br>")}</p>
        ${summary}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px;"><tr><td align="center" bgcolor="#174b30" style="border-radius:8px;mso-padding-alt:15px 24px;">
          <a href="${link}" style="display:inline-block;padding:15px 24px;border:1px solid #174b30;border-radius:8px;font-size:16px;line-height:22px;font-weight:700;text-decoration:none;color:#ffffff;">Revisar minha tarefa</a>
        </td></tr></table>
        <p style="margin:0;font-size:14px;line-height:22px;color:#52645a;">Você decide o próximo passo. A compra só acontece após sua confirmação no checkout.</p>
      </td></tr>
      <tr><td style="padding:22px 24px 26px;border-top:1px solid #e1e8e3;background-color:#f8faf9;">
        <p style="margin:0 0 10px;font-size:12px;line-height:20px;color:#52645a;">Você recebeu este aviso porque ativou as notificações do seu agente nesta loja. Para pausar os avisos, acesse <a href="${link}" style="color:#174b30;text-decoration:underline;">Meu agente</a>.</p>
        <p style="margin:0;font-size:12px;line-height:20px;color:#52645a;overflow-wrap:anywhere;">Se o botão não abrir, <a href="${link}" style="color:#174b30;text-decoration:underline;">use este link para revisar sua tarefa</a>.</p>
      </td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;line-height:20px;color:#52645a;">Uma comunicação de <strong>${store}</strong>, enviada pela Zyon.</p>
  </td></tr></table>
</body></html>`;
  const text = `${input.storeName}\nSeu agente pessoal de compras\n\nOlá, ${input.buyerName}.\n\n${input.activity.message}\n${quote ? `\n${quote.items.map(i => `${i.quantity} × ${i.name}`).join("\n")}\n${quote.shippingCents === null ? "Total sem frete" : "Total para revisar"}: ${money(quote.totalCents)}\nPreço e disponibilidade serão confirmados no checkout.\n` : ""}\nRevisar minha tarefa: ${url.href}\n\nA compra só acontece após sua confirmação no checkout.\nPara pausar os avisos, acesse Meu agente pelo mesmo link.\n\nUma comunicação de ${input.storeName}, enviada pela Zyon.`;
  return { subject, html, text, ...(logo.attachments ? { attachments: logo.attachments } : {}) };
}
