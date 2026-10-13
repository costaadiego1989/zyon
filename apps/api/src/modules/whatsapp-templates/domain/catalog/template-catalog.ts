import type {
  WhatsAppTemplateType,
  WhatsAppTemplateCategory,
} from "./template-types.js";

/**
 * A catalog definition is the platform's default for one message type. It holds
 * both a freeform body (email + inside the 24h WhatsApp session window) and a
 * Meta positional body ({{1}} {{2}} …) that is submitted to Meta for approval.
 *
 * The positional body + variableMap are the source of truth for Meta submission
 * and for resolving ContentVariables at send time.
 */
export interface WhatsAppTemplateDefinition {
  type: WhatsAppTemplateType;
  label: string;
  category: WhatsAppTemplateCategory;
  language: string;
  /** Named-placeholder body: {{buyerName}}, {{productName}}, {{couponBlock}}, {{orderId}}, {{trackingCode}}. */
  freeformBody: string;
  /** Positional body for Meta: {{1}} {{2}} … */
  metaBody: string;
  /** position → semantic name, e.g. {"1":"buyerName","2":"couponBlock"}. */
  variableMap: Record<string, string>;
  /** sample values per position for the Meta approval request. */
  sampleVariables: Record<string, string>;
  /** whether this type carries a coupon (drives {{couponBlock}} presence). */
  hasCoupon: boolean;
}

const SAMPLES: Record<string, string> = {
alertName: "MarketplaceOutboxDeliveryFailures",
alertStatus: "ativo",
alertSeverity: "crítica",
observedAt: "03/10/2026, 10:00",
  merchantName: "Loja Exemplo", planName: "Growth", expiresAt: "21/09/2026, 10:00", dashboardLink: "https://app.zyon-payments.com.br/#billing-plans",
  buyerName: "Ana",
  productName: "seu pedido",
  storeName: "Loja Exemplo",
  couponBlock: "cupom LOJA10 (10% OFF)",
  coupon: "LOJA10",
  discount: "10%",
  orderId: "PED-1234",
  trackingCode: "BR123456789",
  link: "https://loja.exemplo",
  otpCode: "123456",
  decisionReason: "A análise confirmou o defeito. A loja informará a próxima etapa na conversa.",
};

/**
 * Build the Meta positional body + maps from a named-placeholder body.
 * Named tokens are replaced by {{1}}, {{2}} … in first-appearance order.
 * `storeName` is inlined (not a variable) since Meta discourages a var for it.
 */
export function toPositional(named: string, storeName = "sua loja"): {
  metaBody: string;
  variableMap: Record<string, string>;
  sampleVariables: Record<string, string>;
} {
  const ordered: Array<{ name: string; token: RegExp }> = [
    ...["alertName", "alertStatus", "alertSeverity", "observedAt"].map(name => ({ name, token: new RegExp("\\{\\{" + name + "\\}\\}", "g") })),
    ...["merchantName", "planName", "expiresAt", "dashboardLink"].map(name => ({ name, token: new RegExp("\\{\\{" + name + "\\}\\}", "g") })),
    { name: "buyerName", token: /\{\{buyerName\}\}/g },
    { name: "productName", token: /\{\{productName\}\}/g },
    { name: "orderId", token: /\{\{orderId\}\}/g },
    { name: "trackingCode", token: /\{\{trackingCode\}\}/g },
    { name: "otpCode", token: /\{\{otpCode\}\}/g },
    { name: "couponBlock", token: /\{\{couponBlock\}\}/g },
    { name: "coupon", token: /\{\{coupon\}\}/g },
    { name: "discount", token: /\{\{discount\}\}/g },
    { name: "decisionReason", token: /\{\{decisionReason\}\}/g },
    { name: "link", token: /\{\{link\}\}/g },
  ];
  let body = named.replace(/\{\{storeName\}\}/g, storeName);
  const variableMap: Record<string, string> = {};
  const sampleVariables: Record<string, string> = {};
  let pos = 0;
  for (const v of ordered) {
    if (!v.token.test(body)) continue;
    pos += 1;
    const p = String(pos);
    variableMap[p] = v.name;
    sampleVariables[p] = SAMPLES[v.name] ?? "";
    body = body.replace(v.token, `{{${p}}}`);
  }
  return { metaBody: body.replace(/\n{3,}/g, "\n\n").trim(), variableMap, sampleVariables };
}

// Named-placeholder freeform bodies (source of truth for both channels).
const FREEFORM: Record<WhatsAppTemplateType, string> = {
marketplace_operational_alert: "Zyon: alerta operacional {{alertName}} está {{alertStatus}}, gravidade {{alertSeverity}}. Início: {{observedAt}}. Consulte o painel: {{dashboardLink}}.",
  plan_expiry_7d: "Olá, {{merchantName}}. O período do plano {{planName}} na Zyon termina em {{expiresAt}} (horário de Brasília). Este é o lembrete de 7 dias para que você revise a renovação em {{dashboardLink}}.\n\nEquipe Zyon.",
  plan_expiry_3d: "Olá, {{merchantName}}. O período do plano {{planName}} na Zyon termina em {{expiresAt}} (horário de Brasília). Faltam 3 dias para o vencimento. Revise a assinatura e a forma de pagamento em {{dashboardLink}}.\n\nEquipe Zyon.",
  plan_expiry_24h: "Olá, {{merchantName}}. O período do plano {{planName}} na Zyon termina em {{expiresAt}} (horário de Brasília). Restam menos de 24 horas. Confira a renovação em {{dashboardLink}}.\n\nEquipe Zyon.",
  plan_expiry_expired: "Olá, {{merchantName}}. O período atual do plano {{planName}} na Zyon terminou em {{expiresAt}} (horário de Brasília) e a renovação ainda não foi identificada. Consulte sua assinatura em {{dashboardLink}}.\n\nEquipe Zyon.",
  follow_up: "Olá, {{buyerName}}!\n\nQueremos confirmar se o seu {{productName}} chegou bem e se está tudo certo com o pedido. Se precisar de qualquer apoio, responda a esta mensagem.\n\nAtenciosamente,\n{{storeName}}",
  review_request: "Olá, {{buyerName}}!\n\nSua experiência com {{productName}} é muito importante para nós. De 1 a 5 estrelas, qual nota você daria para sua compra? Se quiser, conte também o que podemos melhorar.\n\nAtenciosamente,\n{{storeName}}",
  nps: "Olá, {{buyerName}}!\n\nEm uma escala de 1 a 5 estrelas, o quanto você recomendaria a sua experiência com {{storeName}} após a compra de {{productName}}? Sua resposta nos ajuda a evoluir.\n\nAtenciosamente,\n{{storeName}}",
  cross_sell: "Olá, {{buyerName}}!\n\nSelecionamos opções que combinam com {{productName}} e podem complementar sua compra.\n\n{{couponBlock}}\n\nConfira as condições e escolha quando fizer sentido para você.\n\nAtenciosamente,\n{{storeName}}",
  win_back: "Olá, {{buyerName}}!\n\nFaz um tempo desde sua última compra na {{storeName}}. Quando quiser voltar, confira os produtos disponíveis na loja.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}",
  loyalty: "Olá, {{buyerName}}!\n\nAgradecemos por escolher a {{storeName}} novamente. Confira as condições disponíveis na loja.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}",
  reorder: "Olá, {{buyerName}}!\n\nPode estar chegando o momento de repor {{productName}}. Se for útil para você, veja a condição disponível e as opções da loja.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}",
  cart_recovery: "Olá, {{buyerName}}!\n\nVimos que há itens aguardando no seu carrinho da {{storeName}}. Se ainda quiser concluir a compra, você pode retomar pelo checkout.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}",
  digital_delivery: `Olá, {{buyerName}}! O pagamento do pedido {{orderId}} foi confirmado.

Seu produto digital {{productName}} está disponível. Acesse pelo link: {{link}}

Guarde este link para baixar seu produto.`,

  order_confirmation: "Olá, {{buyerName}}!\n\nRecebemos o pedido {{orderId}} e já iniciamos a preparação. Você receberá uma nova atualização assim que houver mudança no status.\n\nAtenciosamente,\n{{storeName}}",
  order_nonphysical_confirmation: `Olá, {{buyerName}}! O pagamento do pedido {{orderId}} na {{storeName}} foi confirmado.

Consulte as informações da sua compra. O acesso a produtos digitais é enviado em uma mensagem separada. Para serviços, combine o atendimento com a loja.`,

  order_shipped: "Olá, {{buyerName}}!\n\nSeu pedido {{orderId}} foi enviado e já está a caminho. Código de rastreio: {{trackingCode}}.\n\nSe precisar de apoio durante a entrega, responda a esta mensagem.\n\nAtenciosamente,\n{{storeName}}",
  order_delivered: "Olá, {{buyerName}}!\n\nConfirmamos a entrega do pedido {{orderId}}. Esperamos que {{productName}} atenda às suas expectativas. Se precisar de suporte, estamos à disposição.\n\nAtenciosamente,\n{{storeName}}",
  return_authorized: `Olá, {{buyerName}}. A {{storeName}} autorizou o envio dos itens do pedido {{orderId}} para análise: {{productName}}. Instruções: {{decisionReason}}. Veja a conversa: {{link}}. Acesse sua conta para acompanhar.`,
  return_approved: `Olá, {{buyerName}}. A {{storeName}} aprovou sua solicitação referente ao pedido {{orderId}}, itens: {{productName}}. Próximos passos: {{decisionReason}}. Acompanhe em {{link}}. O reembolso, quando aplicável, será confirmado separadamente.`,
  return_rejected: `Olá, {{buyerName}}. Após a análise, a {{storeName}} não aprovou sua solicitação do pedido {{orderId}}, itens: {{productName}}. Motivo: {{decisionReason}}. Consulte os detalhes em {{link}}. Acesse sua conta para ver a conversa.`,
  return_refunded: `Olá, {{buyerName}}. O provedor de pagamento confirmou o reembolso do pedido {{orderId}}, itens: {{productName}}. Detalhes: {{decisionReason}}. Acompanhe em {{link}}. O prazo de crédito depende do meio de pagamento.`,
  exchange_completed: `Olá, {{buyerName}}. A {{storeName}} concluiu a troca dos itens {{productName}} do pedido {{orderId}} e confirmou a entrega. Detalhes: {{decisionReason}}. Consulte a conversa em {{link}}. O histórico continua disponível na sua conta.`,
  return_posting_code: `Olá, {{buyerName}}. A {{storeName}} disponibilizou o código de devolução dos itens {{productName}} do pedido {{orderId}}. Instruções: {{decisionReason}}. Consulte os documentos em {{link}}.`,
  return_declaration_ready: `Olá, {{buyerName}}. A declaração de conteúdo para devolver os itens {{productName}} do pedido {{orderId}} à {{storeName}} está disponível. Instruções: {{decisionReason}}. Imprima o documento na conversa: {{link}}.`,
  checkout_otp: `{{otpCode}} é seu código de verificação. Para sua segurança, não compartilhe este código.`,
};

const HAS_COUPON: Record<WhatsAppTemplateType, boolean> = {
marketplace_operational_alert: false,
  checkout_otp: false,
  plan_expiry_7d: false, plan_expiry_3d: false, plan_expiry_24h: false, plan_expiry_expired: false,
  follow_up: false,
  review_request: false,
  nps: false,
  cross_sell: true,
  win_back: true,
  loyalty: true,
  reorder: true,
  cart_recovery: true,
  order_confirmation: false,
  order_nonphysical_confirmation: false,
  digital_delivery: false,
  order_shipped: false,
  order_delivered: false,
  return_authorized: false, return_approved: false, return_rejected: false, return_refunded: false, exchange_completed: false, return_posting_code: false, return_declaration_ready: false,
};

const LABELS: Record<WhatsAppTemplateType, string> = {
marketplace_operational_alert: "Marketplace: alerta operacional",
  checkout_otp: "Código de confirmação do checkout",
  plan_expiry_7d: "Plano: vencimento em 7 dias", plan_expiry_3d: "Plano: vencimento em 3 dias",
  plan_expiry_24h: "Plano: vencimento em 24 horas", plan_expiry_expired: "Plano: vencido sem renovação",
  follow_up: "Follow-up de Entrega",
  review_request: "Pedido de Review",
  nps: "NPS",
  cross_sell: "Cross-sell",
  win_back: "Win-back",
  loyalty: "Fidelidade",
  reorder: "Recompra",
  cart_recovery: "Recuperação de Carrinho",
  order_confirmation: "Confirmação de Pedido",
  order_nonphysical_confirmation: "Confirmação de Digital e Serviços",
  digital_delivery: "Entrega de Produto Digital",
  order_shipped: "Pedido Enviado",
  order_delivered: "Pedido Entregue",
  return_authorized: "Envio para análise autorizado",
  return_approved: "Troca ou devolução aprovada",
  return_rejected: "Troca ou devolução não aprovada",
  return_refunded: "Reembolso confirmado",
  exchange_completed: "Troca concluída",
  return_posting_code: "Código de devolução disponível",
  return_declaration_ready: "Declaração de conteúdo disponível",
};

// Incentives, reactivation and replenishment campaigns are promotional.
// Template category does not replace recipient consent or current Meta approval.
const MARKETING = new Set<WhatsAppTemplateType>(["cross_sell", "win_back", "loyalty", "reorder", "cart_recovery"]);

export function categoryFor(type: WhatsAppTemplateType): WhatsAppTemplateCategory {
  if (type === "checkout_otp") return "AUTHENTICATION";
  return MARKETING.has(type) ? "MARKETING" : "UTILITY";
}

/**
 * The full platform catalog: one definition per type. Used to seed a merchant's
 * templates on WABA connect, to power the dashboard editor, and to resolve
 * fallbacks at send time.
 */
export function buildCatalog(storeName = "sua loja"): Record<WhatsAppTemplateType, WhatsAppTemplateDefinition> {
  const out = {} as Record<WhatsAppTemplateType, WhatsAppTemplateDefinition>;
  for (const type of Object.keys(FREEFORM) as WhatsAppTemplateType[]) {
    const freeformBody = FREEFORM[type];
    const { metaBody, variableMap, sampleVariables } = toPositional(freeformBody, storeName);
    out[type] = {
      type,
      label: LABELS[type],
      category: categoryFor(type),
      language: "pt_BR",
      freeformBody,
      metaBody,
      variableMap,
      sampleVariables,
      hasCoupon: HAS_COUPON[type],
    };
  }
  return out;
}

export function getTemplateDefinition(
  type: WhatsAppTemplateType,
  storeName = "sua loja"
): WhatsAppTemplateDefinition {
  return buildCatalog(storeName)[type];
}
