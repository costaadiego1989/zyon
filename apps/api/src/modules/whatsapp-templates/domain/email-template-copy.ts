import type { WhatsAppTemplateType } from "./catalog/template-types.js";
import { buildCatalog } from "./catalog/template-catalog.js";
import { cleanEmailSubject } from "../../../shared/messaging/email-content.js";

/** Recipient-facing subjects are independent of the labels in the template editor. */
export const EMAIL_TEMPLATE_SUBJECTS: Record<WhatsAppTemplateType, string> & Record<string, string> = {
  shopping_agent_alert: "{{storeName}} | Atualização do seu agente pessoal",
  marketplace_operational_alert: "Zyon | Alerta operacional do marketplace",
  plan_expiry_7d: "Zyon | Renovação do plano: vencimento em até 7 dias",
  plan_expiry_3d: "Zyon | Renovação do plano: vencimento em até 3 dias",
  plan_expiry_24h: "Zyon | Renovação do plano: vencimento em até 24 horas",
  plan_expiry_expired: "Zyon | Renovação do plano ainda não confirmada",
  follow_up: "{{storeName}} | Está tudo certo com sua compra?",
  review_request: "{{storeName}} | Conte o que achou da sua compra",
  nps: "{{storeName}} | Como foi sua experiência com a loja?",
  cross_sell: "{{storeName}} | Confira outras opções da loja",
  win_back: "{{storeName}} | Confira as novidades da loja",
  loyalty: "{{storeName}} | Obrigado por comprar com a gente",
  reorder: "{{storeName}} | Quer comprar novamente?",
  cart_recovery: "{{storeName}} | Continue de onde parou",
  order_confirmation: "{{storeName}} | Pedido {{orderId}} confirmado",
  order_nonphysical_confirmation: "{{storeName}} | Pagamento do pedido {{orderId}} confirmado",
  digital_delivery: "{{storeName}} | Acesso ao seu produto digital",
  order_shipped: "{{storeName}} | Pedido {{orderId}} enviado",
  order_delivered: "{{storeName}} | Pedido {{orderId}} entregue",
  return_authorized: "{{storeName}} | Pedido {{orderId}}: envio para análise autorizado",
  return_approved: "{{storeName}} | Solicitação do pedido {{orderId}} aprovada",
  return_rejected: "{{storeName}} | Resultado da solicitação do pedido {{orderId}}",
  return_refunded: "{{storeName}} | Reembolso do pedido {{orderId}} confirmado",
  exchange_completed: "{{storeName}} | Troca do pedido {{orderId}} concluída",
  return_posting_code: "{{storeName}} | Código de devolução do pedido {{orderId}}",
  return_declaration_ready: "{{storeName}} | Declaração para devolução do pedido {{orderId}}",
  checkout_otp: "{{storeName}} | Seu código de confirmação",
};

/** Email replies are not ingested by the WhatsApp post-sale reply handler. */
export const POST_SALE_EMAIL_BODIES: Partial<Record<WhatsAppTemplateType, string>> = {
  follow_up: "Olá, {{buyerName}}! Aqui é da {{storeName}}.\n\nEstá tudo certo com sua compra de {{productName}}? Se precisar de ajuda, use o atendimento disponível na loja.",
  review_request: "Olá, {{buyerName}}! Aqui é da {{storeName}}.\n\nQueremos saber o que você achou de {{productName}}. Para compartilhar sua opinião, entre em contato pelo atendimento da loja.\n\nObrigado pela compra!",
  nps: "Olá, {{buyerName}}! Aqui é da {{storeName}}.\n\nComo foi sua experiência de compra? Sua opinião ajuda a melhorar nosso atendimento. Para falar com a gente, use o atendimento disponível na loja.",
  cross_sell: "Olá, {{buyerName}}! Aqui é da {{storeName}}.\n\nVocê comprou {{productName}} e pode conferir outras opções na loja.\n\n{{couponBlock}}\n\nConsulte os produtos e as condições disponíveis na vitrine.",
  win_back: "Olá, {{buyerName}}! Aqui é da {{storeName}}.\n\nFaz um tempo desde sua última compra. Quando quiser voltar, confira os produtos disponíveis na loja.\n\n{{couponBlock}}",
  loyalty: "Olá, {{buyerName}}!\n\nObrigado por comprar com a gente na {{storeName}}.\n\n{{couponBlock}}\n\nSe precisar de ajuda com sua compra, use o atendimento da loja.",
  reorder: "Olá, {{buyerName}}! Aqui é da {{storeName}}.\n\nQuer comprar {{productName}} novamente? Confira a disponibilidade e as condições na loja.\n\n{{couponBlock}}",
};

const LEGACY_PLATFORM_BODIES: Partial<Record<WhatsAppTemplateType, string>> = {
  win_back: `Oi {{buyerName}}! Sentimos sua falta! 💜

Faz um tempo que você não aparece por aqui. A {{storeName}} preparou algo especial pra você voltar.

{{couponBlock}}

Te esperamos! 🙌`,
  loyalty: `Parabéns, {{buyerName}}! 🎉🎊

Você acaba de completar mais uma compra conosco na {{storeName}}!

Como agradecimento pela sua fidelidade, preparamos um benefício exclusivo:

{{couponBlock}}

Obrigado por fazer parte! 💛`,
};

const PREVIOUS_CATALOG_EMAIL_BODIES: Partial<Record<WhatsAppTemplateType, string>> = {
  "follow_up": "Oi {{buyerName}}! 😊 Aqui é da {{storeName}}.\n\nSeu {{productName}} já chegou? Queremos saber se está tudo certo com o pedido!\n\nSe precisar de algo, é só responder aqui. Estamos à disposição! 💬",
  "review_request": "Oi {{buyerName}}! ⭐\n\nVocê recebeu o {{productName}} há alguns dias. O que achou?\n\nDe 1 a 5 estrelas, que nota você dá? Responda com o número (1 a 5) e, se quiser, um comentário!\n\nSua opinião ajuda demais outros clientes. Obrigado! 🙏",
  "nps": "Oi {{buyerName}}! 😊\n\nAqui é da {{storeName}}. Seu pedido do {{productName}} chegou faz uns dias.\n\nDe 1 a 5 estrelas, o quanto você recomendaria a gente? ⭐\n\nÉ só responder com o número (1 a 5) aqui mesmo! 🙏",
  "cross_sell": "Olá, {{buyerName}}, tudo bem? 🎁\n\nComo você comprou o {{productName}}, separamos algumas opções que combinam perfeitamente!\n\n{{couponBlock}}\n\nEstamos à disposição! 💛",
  "win_back": "Oi {{buyerName}}! Sentimos sua falta! 💜\n\nFaz um tempo desde sua última compra na {{storeName}}. Quando quiser voltar, confira os produtos disponíveis na loja.\n\n{{couponBlock}}\n\nTe esperamos! 🙌",
  "loyalty": "Parabéns, {{buyerName}}! 🎉🎊\n\nVocê acaba de completar mais uma compra conosco na {{storeName}}!\n\nObrigado por comprar com a gente. Confira as condições disponíveis na loja:\n\n{{couponBlock}}\n\nObrigado por fazer parte! 💛",
  "reorder": "Olá, {{buyerName}}, tudo bem? 🔔\n\nLembra do {{productName}} que você comprou? Pelo tempo de uso, pode ser que esteja na hora de repor!\n\n{{couponBlock}}\n\nConfira as opções e condições de entrega na loja."
};

const SIGNED_CATALOG_EMAIL_BODIES: Partial<Record<WhatsAppTemplateType, string>> = {
  "follow_up": "Olá, {{buyerName}}!\n\nQueremos confirmar se o seu {{productName}} chegou bem e se está tudo certo com o pedido. Se precisar de qualquer apoio, responda a esta mensagem.\n\nAtenciosamente,\n{{storeName}}",
  "review_request": "Olá, {{buyerName}}!\n\nSua experiência com {{productName}} é muito importante para nós. De 1 a 5 estrelas, qual nota você daria para sua compra? Se quiser, conte também o que podemos melhorar.\n\nAtenciosamente,\n{{storeName}}",
  "nps": "Olá, {{buyerName}}!\n\nEm uma escala de 1 a 5 estrelas, o quanto você recomendaria a sua experiência com {{storeName}} após a compra de {{productName}}? Sua resposta nos ajuda a evoluir.\n\nAtenciosamente,\n{{storeName}}",
  "cross_sell": "Olá, {{buyerName}}!\n\nSelecionamos opções que combinam com {{productName}} e podem complementar sua compra.\n\n{{couponBlock}}\n\nConfira as condições e escolha quando fizer sentido para você.\n\nAtenciosamente,\n{{storeName}}",
  "win_back": "Olá, {{buyerName}}!\n\nSentimos sua falta. A {{storeName}} separou uma condição especial para uma próxima compra, conforme as regras da oferta.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}",
  "loyalty": "Olá, {{buyerName}}!\n\nAgradecemos por escolher a {{storeName}} novamente. Como reconhecimento pela sua fidelidade, liberamos a condição abaixo.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}",
  "reorder": "Olá, {{buyerName}}!\n\nPode estar chegando o momento de repor {{productName}}. Se for útil para você, veja a condição disponível e as opções da loja.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}"
};

/** Update untouched platform copy at rendering time, preserving merchant edits. */
export function resolveTemplateEmailBody(type: WhatsAppTemplateType, configured: string): string {
  const updated = POST_SALE_EMAIL_BODIES[type];
  const comparable = (value: string) => value.replace(/\r\n/g, "\n").trim();
  return updated && [buildCatalog()[type].freeformBody, LEGACY_PLATFORM_BODIES[type], PREVIOUS_CATALOG_EMAIL_BODIES[type], SIGNED_CATALOG_EMAIL_BODIES[type]]
    .some(body => body != null && comparable(body) === comparable(configured)) ? updated : configured;
}

export function resolveTemplateEmailSubject(type: WhatsAppTemplateType, configured: string | undefined | null,
  variables: Record<string, string | number | undefined> = {}): string {
  // Account notices are authored by Zyon. A saved order subject cannot rename them.
  const canonical = EMAIL_TEMPLATE_SUBJECTS[type];
  const legacy = `{{storeName}} | ${buildCatalog()[type].label}`;
  const source = type.startsWith("plan_expiry_") || configured?.trim() === legacy ? canonical : configured?.trim() || canonical;
  const render = (value: string) => cleanEmailSubject(value.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(variables[key] ?? (key === "storeName" ? "Sua loja" : key === "buyerName" ? "Cliente" : ""))));
  return render(source) || render(canonical);
}
