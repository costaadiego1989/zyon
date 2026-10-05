import type { ReturnNoticePayload, ReturnNoticeType } from "../../domain/return-notice.js";

const COPY: Record<ReturnNoticeType, { badge: string; title: string; description: string }> = {
  return_authorized: { badge: "Envio autorizado", title: "Vamos acompanhar sua solicitação", description: "A loja autorizou o envio dos itens para análise. Confira abaixo as instruções do atendente." },
  return_approved: { badge: "Solicitação aprovada", title: "Sua solicitação foi aprovada", description: "Confira a decisão da loja e os próximos passos. Você pode acompanhar cada atualização na conversa." },
  return_rejected: { badge: "Análise concluída", title: "Uma atualização sobre sua solicitação", description: "Após analisar os itens, a loja não aprovou a solicitação. A explicação do atendente está abaixo." },
  return_refunded: { badge: "Reembolso confirmado", title: "Seu reembolso foi confirmado", description: "O provedor de pagamento confirmou o reembolso. O prazo para aparecer na sua conta depende do meio de pagamento." },
  exchange_completed: { badge: "Troca concluída", title: "Sua troca foi concluída", description: "A loja registrou a reposição e confirmou a entrega. Confira os detalhes abaixo." },
};
export function escapeReturnHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}
export function renderReturnDecisionEmail(input: ReturnNoticePayload & {
  type: ReturnNoticeType; storeName: string; buyerName: string; link: string; customBody?: string; customSubject?: string;
}): { subject: string; html: string } {
  const url = new URL(input.link);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_support_link");
  const copy = COPY[input.type];
  const e = escapeReturnHtml;
  const subject = (input.customSubject || `${input.storeName} | ${copy.badge}`).replace(/[\r\n]/g, " ");
  const rows = input.items.map(item => `<tr><td style="padding:12px 0;border-bottom:1px solid #e8ece9;color:#26382d;font-size:15px">${e(item.name)}</td><td style="padding:12px 0;border-bottom:1px solid #e8ece9;text-align:right;color:#53665a;font-size:14px">${item.quantity} un.</td></tr>`).join("");
  const extra = input.customBody ? `<p style="color:#53665a;font-size:15px;line-height:1.7">${e(input.customBody).replace(/\n/g, "<br>")}</p>` : "";
  const explanationTitle = input.type === "return_rejected" ? "Motivo informado pela loja" : "Mensagem do atendente e próximos passos";
  return { subject, html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f2f5f3;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e4ebe6;border-radius:16px"><tr><td style="padding:32px 28px 12px"><p style="margin:0 0 22px;font-size:13px;color:#5b7163">${e(input.storeName)} · Atendimento ao cliente</p><span style="display:inline-block;padding:7px 11px;border-radius:6px;background:#edf4ef;color:#315c40;font-size:12px;font-weight:bold">${copy.badge}</span><h1 style="margin:18px 0 14px;color:#20382a;font-size:28px;line-height:1.2;letter-spacing:-0.5px">${copy.title}</h1><p style="color:#53665a;font-size:16px;line-height:1.7">Olá, ${e(input.buyerName)}.<br>${copy.description}</p></td></tr><tr><td style="padding:0 28px 24px"><p style="font-size:12px;line-height:1.6;color:#617269;margin:8px 0;overflow-wrap:anywhere;word-break:break-word">${input.kind === "exchange" ? "Troca" : "Devolução"} · Pedido ${e(input.orderId)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table><h2 style="margin:26px 0 10px;color:#26382d;font-size:16px">${explanationTitle}</h2><div style="padding:18px;background:#f5f7f5;border-left:3px solid #8bac97;border-radius:6px;color:#384b3e;font-size:15px;line-height:1.7">${e(input.explanation).replace(/\n/g, "<br>")}</div>${extra}<p style="margin:26px 0"><a href="${e(url.href)}" style="display:inline-block;background:#285c3b;color:#fff;text-decoration:none;font-size:15px;font-weight:bold;padding:16px 22px;border-radius:8px">Ver conversa com a loja</a></p><p style="font-size:13px;line-height:1.7;color:#617269">Acesse sua conta para consultar a conversa e os detalhes do pedido. Se precisar falar com a loja, use o atendimento na sua conta.</p></td></tr><tr><td style="padding:20px 28px;border-top:1px solid #edf1ee;color:#718076;font-size:12px;line-height:1.6">Esta mensagem acompanha uma solicitação feita por você na ${e(input.storeName)}.</td></tr></table></td></tr></table></body></html>` };
}
