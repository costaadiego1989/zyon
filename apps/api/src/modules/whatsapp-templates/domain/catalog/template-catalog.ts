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
  buyerName: "Ana",
  productName: "seu pedido",
  storeName: "Loja Exemplo",
  couponBlock: "cupom LOJA10 (10% OFF)",
  coupon: "LOJA10",
  discount: "10%",
  orderId: "PED-1234",
  trackingCode: "BR123456789",
  link: "https://loja.exemplo",
};

/**
 * Build the Meta positional body + maps from a named-placeholder body.
 * Named tokens are replaced by {{1}}, {{2}} … in first-appearance order.
 * `storeName` is inlined (not a variable) since Meta discourages a var for it.
 */
function toPositional(named: string, storeName = "sua loja"): {
  metaBody: string;
  variableMap: Record<string, string>;
  sampleVariables: Record<string, string>;
} {
  const ordered: Array<{ name: string; token: RegExp }> = [
    { name: "buyerName", token: /\{\{buyerName\}\}/g },
    { name: "productName", token: /\{\{productName\}\}/g },
    { name: "orderId", token: /\{\{orderId\}\}/g },
    { name: "trackingCode", token: /\{\{trackingCode\}\}/g },
    { name: "couponBlock", token: /\{\{couponBlock\}\}/g },
    { name: "coupon", token: /\{\{coupon\}\}/g },
    { name: "discount", token: /\{\{discount\}\}/g },
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
  follow_up: `Oi {{buyerName}}! 😊 Aqui é da {{storeName}}.

Seu {{productName}} já chegou? Queremos saber se está tudo certo com o pedido!

Se precisar de algo, é só responder aqui. Estamos à disposição! 💬`,

  review_request: `Oi {{buyerName}}! ⭐

Você recebeu o {{productName}} há alguns dias. O que achou?

De 1 a 5 estrelas, que nota você dá? Responda com o número (1 a 5) e, se quiser, um comentário!

Sua opinião ajuda demais outros clientes. Obrigado! 🙏`,

  nps: `Oi {{buyerName}}! 😊

Aqui é da {{storeName}}. Seu pedido do {{productName}} chegou faz uns dias.

De 1 a 5 estrelas, o quanto você recomendaria a gente? ⭐

É só responder com o número (1 a 5) aqui mesmo! 🙏`,

  cross_sell: `{{buyerName}}, tudo bem? 🎁

Como você comprou o {{productName}}, separamos algumas opções que combinam perfeitamente!

{{couponBlock}}

Estamos à disposição! 💛`,

  win_back: `Oi {{buyerName}}! Sentimos sua falta! 💜

Faz um tempo que você não aparece por aqui. A {{storeName}} preparou algo especial pra você voltar.

{{couponBlock}}

Te esperamos! 🙌`,

  loyalty: `Parabéns, {{buyerName}}! 🎉🎊

Você acaba de completar mais uma compra conosco na {{storeName}}!

Como agradecimento pela sua fidelidade, preparamos um benefício exclusivo:

{{couponBlock}}

Obrigado por fazer parte! 💛`,

  reorder: `{{buyerName}}, tudo bem? 🔔

Lembra do {{productName}} que você comprou? Pelo tempo de uso, pode ser que esteja na hora de repor!

{{couponBlock}}

Cuidamos do frete pra você! 📦`,

  cart_recovery: `Oi {{buyerName}}! 🛒

Você deixou alguns itens no carrinho na {{storeName}}. Ainda dá tempo de concluir!

{{couponBlock}}

Qualquer dúvida, é só chamar. 💬`,

  order_confirmation: `Oi {{buyerName}}! ✅

Recebemos seu pedido {{orderId}} na {{storeName}} e já estamos preparando tudo.

Você será avisado quando ele for enviado. Obrigado pela compra! 💛`,

  order_shipped: `Boa notícia, {{buyerName}}! 📦

Seu pedido {{orderId}} foi enviado. Código de rastreio: {{trackingCode}}.

Acompanhe a entrega e qualquer coisa é só falar com a gente. 🚚`,

  order_delivered: `{{buyerName}}, seu pedido {{orderId}} foi entregue! 🎉

Esperamos que esteja tudo perfeito. Se precisar de qualquer coisa com o {{productName}}, é só responder aqui. 💬`,
};

const HAS_COUPON: Record<WhatsAppTemplateType, boolean> = {
  follow_up: false,
  review_request: false,
  nps: false,
  cross_sell: true,
  win_back: true,
  loyalty: true,
  reorder: true,
  cart_recovery: true,
  order_confirmation: false,
  order_shipped: false,
  order_delivered: false,
};

const LABELS: Record<WhatsAppTemplateType, string> = {
  follow_up: "Follow-up de Entrega",
  review_request: "Pedido de Review",
  nps: "NPS",
  cross_sell: "Cross-sell",
  win_back: "Win-back",
  loyalty: "Fidelidade",
  reorder: "Recompra",
  cart_recovery: "Recuperação de Carrinho",
  order_confirmation: "Confirmação de Pedido",
  order_shipped: "Pedido Enviado",
  order_delivered: "Pedido Entregue",
};

// Only cross_sell + win_back + cart_recovery are promotional → MARKETING.
// Everything transactional is UTILITY (faster Meta approval, no opt-in needed).
const MARKETING = new Set<WhatsAppTemplateType>(["cross_sell", "win_back", "cart_recovery"]);

export function categoryFor(type: WhatsAppTemplateType): WhatsAppTemplateCategory {
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
