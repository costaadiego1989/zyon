/**
 * WhatsApp Commerce Templates — Pure Domain Functions
 *
 * Each template receives typed data and returns formatted WhatsApp text.
 * Uses WhatsApp markdown: *bold*, _italic_, ~strikethrough~
 * Appends numbered quick replies at the end.
 * Zero dependencies (no NestJS, no I/O).
 */

// ─── Data Types ─────────────────────────────────────────────────────────────

export interface WaProductCardData {
  name: string;
  priceFormatted: string;
  description?: string;
  rating?: number;
  reviewCount?: number;
  inStock: boolean;
  originalPriceFormatted?: string;
  discountPercent?: number;
  sellerName?: string;
  variants?: Array<{ name: string; value: string }>;
}

export interface WaProductListData {
  title: string;
  products: Array<{ name: string; priceFormatted: string; inStock: boolean; discountPercent?: number }>;
  hasMore: boolean;
}

export interface WaCategoryListData {
  categories: Array<{ name: string; emoji?: string; productCount?: number }>;
  hasMore: boolean;
}

export interface WaCartNotificationData {
  lastItemName: string;
  itemCount: number;
  total: string;
  discount?: string;
}

export interface WaCartFullData {
  items: Array<{ name: string; quantity: number; variant?: string; lineTotal: string }>;
  itemCount: number;
  subtotal: string;
  shipping: string;
  discount?: string;
  serviceFee?: string;
  total: string;
}

export interface WaShippingOptionData {
  carrier: string;
  method?: string;
  days: number;
  price: string;
  isFree: boolean;
}

export interface WaShippingOptionsData {
  destinationZip: string;
  options: WaShippingOptionData[];
}

export interface WaOrderConfirmedData {
  orderId: string;
  customerName: string;
  items: Array<{ name: string; quantity: number; lineTotal: string }>;
  total: string;
  carrier?: string;
  estimatedDelivery?: string;
  address: string;
  trackingCode?: string;
}

export interface WaCrossSellData {
  trigger: string;
  products: Array<{ name: string; priceFormatted: string }>;
}

export interface WaPaymentLinkData {
  method: "pix" | "credit_card" | "boleto";
  url: string;
  amount: string;
  expiresInMinutes: number;
  gateway?: string;
}

export interface WaOfferData {
  discountLabel: string;
  savingsLabel: string;
  newTotal: string;
  freeShipping: boolean;
}

export interface WaPaymentSummaryData {
  customerName: string;
  address: string;
  items: Array<{ name: string; quantity: number; lineTotal: string }>;
  subtotal: string;
  shipping: string;
  shippingDetail?: string;
  discount?: string;
  total: string;
  paymentOptions: string[];
}

export interface WaMarketplaceData {
  products: Array<{ name: string; priceFormatted: string; sellerName: string }>;
  hasMore: boolean;
}

export interface WaWelcomeData {
  merchantName: string;
  buyerName?: string;
  isReturning: boolean;
  quickReplies: string[];
}

export interface WaDataCollectionPromptData {
  field: "nome" | "email" | "cpf" | "telefone" | "otp_email" | "otp_sms";
  quickReplies: string[];
  skippedFields?: string[];
}

export interface WaShippingPromptData {
  subField: "cep" | "confirmar" | "numero" | "complemento" | "frete";
  address?: { street: string; city: string; state: string };
  quickReplies: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SEP = "──────────────────";

export function formatBRL(valueInReais: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valueInReais);
}

export function formatCentsAsBRL(cents: number): string {
  return formatBRL(cents / 100);
}

export function renderNumberedMenu(options: string[], showBack = true): string {
  const lines = options.map((opt, i) => `${numberEmoji(i + 1)} ${opt}`);
  if (showBack) lines.push("↩️ 0 — Voltar");
  return lines.join("\n");
}

function numberEmoji(n: number): string {
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return emojis[n - 1] ?? `${n}.`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

// ─── Templates ──────────────────────────────────────────────────────────────

/**
 * T01: Welcome — first message or session start
 * Handles returning buyers with pre-filled data
 */
export function renderWelcome(data: WaWelcomeData): string {
  const greeting = data.isReturning && data.buyerName
    ? `👋 Olá de volta, *${data.buyerName}*! Bem-vindo à *${data.merchantName}*!`
    : `👋 Olá! Bem-vindo à *${data.merchantName}*!`;

  const intro = data.isReturning
    ? "Como posso te ajudar hoje?"
    : "Sou o assistente virtual e posso te ajudar a fazer seu pedido.";

  return [
    greeting,
    "",
    intro,
    "",
    renderNumberedMenu(data.quickReplies, false),
    "",
    "_Responda com o número ou digite o que procura_",
  ].join("\n");
}

/**
 * T02: Product Card — single product detail view
 * Maps to StorefrontProductCardBlock
 */
export function renderProductCard(data: WaProductCardData): string {
  const lines: string[] = [];

  lines.push(`🛍️ *${data.name}*`);

  if (data.discountPercent && data.discountPercent > 0) {
    lines.push(`🏷️ *-${data.discountPercent}%*`);
  }
  if (data.originalPriceFormatted) {
    lines.push(`~${data.originalPriceFormatted}~`);
  }
  lines.push(`*${data.priceFormatted}*`);
  lines.push("");

  if (data.description) {
    lines.push(truncate(data.description, 120));
    lines.push("");
  }

  if (data.rating) {
    lines.push(`⭐ ${data.rating} (${data.reviewCount ?? 0} avaliações)`);
  }

  lines.push(data.inStock ? "🟢 Em estoque" : "🔴 Esgotado");

  if (data.sellerName) {
    lines.push(`🏪 Vendido por ${data.sellerName}`);
  }

  if (data.variants?.length) {
    lines.push(`📐 Variantes: ${data.variants.map((v) => v.value).join(", ")}`);
  }

  lines.push("");
  lines.push(SEP);

  const options = data.inStock
    ? ["Adicionar ao Carrinho", "Mais Informações", "Ver Avaliações", "Tirar Dúvidas", "Comparar", "Lista de Desejos", "Produtos Semelhantes"]
    : ["Avise quando disponível", "Mais Informações", "Ver Avaliações", "Produtos Semelhantes"];

  lines.push(renderNumberedMenu(options));

  return lines.join("\n");
}

/**
 * T03: Product List — paginated (max 5 per page)
 * Maps to StorefrontProductCarouselBlock
 */
export function renderProductList(data: WaProductListData): string {
  const lines: string[] = [];

  lines.push(`🛍️ *${data.title}*`);
  lines.push("");

  data.products.slice(0, 5).forEach((p, i) => {
    let line = `${numberEmoji(i + 1)} ${truncate(p.name, 30)} — ${p.priceFormatted}`;
    if (p.discountPercent && p.discountPercent > 0) line += ` 🏷️-${p.discountPercent}%`;
    if (!p.inStock) line += " ⚠️";
    lines.push(line);
  });

  lines.push("");
  if (data.hasMore) lines.push("⬇️ 6 — Carregar mais");
  lines.push("↩️ 0 — Voltar");
  lines.push("");
  lines.push("_Responda com o número do produto_");

  return lines.join("\n");
}

/**
 * T04: Category List
 * Maps to StorefrontCategoryCarouselBlock
 */
export function renderCategoryList(data: WaCategoryListData): string {
  const lines: string[] = [];

  lines.push("📂 *Categorias*");
  lines.push("");

  data.categories.slice(0, 5).forEach((cat, i) => {
    const emoji = cat.emoji || "📦";
    const count = cat.productCount ? ` (${cat.productCount})` : "";
    lines.push(`${numberEmoji(i + 1)} ${emoji} ${cat.name}${count}`);
  });

  lines.push("");
  if (data.hasMore) lines.push("⬇️ 6 — Mais categorias");
  lines.push("↩️ 0 — Menu principal");
  lines.push("");
  lines.push("_Responda com o número da categoria_");

  return lines.join("\n");
}

/**
 * T05: Cart Notification — item just added
 * Maps to StorefrontCartSummaryBlock
 */
export function renderCartNotification(data: WaCartNotificationData): string {
  const lines: string[] = [];

  lines.push(`✅ *${data.lastItemName}* adicionado!`);
  lines.push("");
  const itemWord = data.itemCount === 1 ? "item" : "itens";
  lines.push(`🛒 ${data.itemCount} ${itemWord} — *${data.total}*`);

  if (data.discount) {
    lines.push(`🏷️ Desconto aplicado: -${data.discount}`);
  }

  lines.push("");

  const options = ["Ver Carrinho", "Continuar Comprando", "Produtos Similares", "Aplicar Cupom", "Finalizar Compra"];
  lines.push(renderNumberedMenu(options, false));

  return lines.join("\n");
}

/**
 * T06: Full Cart — detailed view with totals
 * Maps to Widget CartPanel
 */
export function renderCartFull(data: WaCartFullData): string {
  const lines: string[] = [];

  const itemWord = data.itemCount === 1 ? "item" : "itens";
  lines.push(`🛒 *Seu Pedido* (${data.itemCount} ${itemWord})`);
  lines.push(SEP);

  for (const item of data.items) {
    const variant = item.variant ? ` (${item.variant})` : "";
    lines.push(`• ${item.quantity}x ${item.name}${variant}     ${item.lineTotal}`);
  }

  lines.push(SEP);
  lines.push(`Subtotal:       ${data.subtotal}`);

  if (data.shipping === "a calcular") {
    lines.push("Envio:          _a calcular_");
  } else {
    lines.push(`Envio:          ${data.shipping}`);
  }

  if (data.discount) {
    lines.push(`Desconto:       -${data.discount}`);
  }
  if (data.serviceFee) {
    lines.push(`Taxa serviço:   ${data.serviceFee}`);
  }

  lines.push(SEP);
  lines.push(`*Total:         ${data.total}*`);
  lines.push("");
  lines.push("🔒 _Nada será cobrado agora — você revisa o valor final antes de confirmar._");
  lines.push("");

  const options = ["Finalizar pedido", "Continuar comprando", "Remover item", "Alterar quantidade", "Aplicar cupom"];
  lines.push(renderNumberedMenu(options));

  return lines.join("\n");
}

/**
 * T07: Shipping Options
 * Maps to StorefrontShippingOptionsBlock / Widget ShippingSelector
 */
export function renderShippingOptions(data: WaShippingOptionsData): string {
  const lines: string[] = [];

  lines.push(`📦 *Opções de envio para ${data.destinationZip}:*`);
  lines.push("");

  data.options.forEach((opt, i) => {
    const method = opt.method ? ` ${opt.method}` : "";
    const price = opt.isFree ? "Grátis ✨" : opt.price;
    lines.push(`${numberEmoji(i + 1)} 🚚 ${opt.carrier}${method} (${opt.days} dias) — ${price}`);
  });

  lines.push("");
  lines.push("_ou pergunte:_");
  const extraIdx = data.options.length + 1;
  lines.push(`${numberEmoji(extraIdx)} Tem frete grátis?`);
  lines.push(`${numberEmoji(extraIdx + 1)} O prazo está muito longo`);
  lines.push(`${numberEmoji(extraIdx + 2)} Tem transportadora mais rápida?`);
  lines.push("");
  lines.push("_Responda com o número_");

  return lines.join("\n");
}

/**
 * T08: Order Confirmed — post-payment
 * Maps to StorefrontOrderConfirmationBlock
 */
export function renderOrderConfirmed(data: WaOrderConfirmedData): string {
  const lines: string[] = [];

  lines.push("🎉 *Pagamento confirmado!*");
  lines.push("");
  lines.push(`Pedido *#${data.orderId}*`);
  lines.push(SEP);

  for (const item of data.items) {
    lines.push(`• ${item.quantity}x ${item.name}     ${item.lineTotal}`);
  }

  lines.push(SEP);
  lines.push(`*Total: ${data.total}*`);
  lines.push("");
  lines.push("📦 *Entrega:*");

  if (data.carrier && data.estimatedDelivery) {
    lines.push(`• ${data.carrier} — ~${data.estimatedDelivery}`);
  }
  lines.push(`• ${data.address}`);
  lines.push("");

  if (data.trackingCode) {
    lines.push(`📬 Rastreio: ${data.trackingCode}`);
  } else {
    lines.push("📬 Código de rastreio será enviado aqui quando disponível.");
  }

  lines.push("");
  lines.push(SEP);
  lines.push(`Obrigado, ${data.customerName}! 💚`);
  lines.push(SEP);
  lines.push("");

  const options = ["Fazer novo pedido", "Quero acompanhar o pedido", "Voltar à loja"];
  lines.push(renderNumberedMenu(options, false));

  return lines.join("\n");
}

/**
 * T09: Cross-Sell suggestion
 * Maps to StorefrontCrossSellBlock / Widget CrossSellBanner
 */
export function renderCrossSell(data: WaCrossSellData): string {
  const lines: string[] = [];

  lines.push(`💡 *${data.trigger}*`);
  lines.push("");

  data.products.slice(0, 3).forEach((p, i) => {
    lines.push(`${numberEmoji(i + 1)} ${p.name} — ${p.priceFormatted}`);
  });

  lines.push("");
  lines.push(`${numberEmoji(data.products.length + 1)} Continuar sem adicionar`);

  lines.push("");
  lines.push("_Responda com o número para adicionar_");

  return lines.join("\n");
}

/**
 * T10: Payment Link — Pix, Card, or Boleto
 * Maps to Widget PixWaiting / payment intent response
 */
export function renderPaymentLink(data: WaPaymentLinkData): string {
  const lines: string[] = [];

  switch (data.method) {
    case "pix":
      lines.push("⚡ *Pagamento via Pix*");
      lines.push("");
      lines.push("Clique no link para pagar:");
      lines.push(`🔗 ${data.url}`);
      lines.push("");
      lines.push(`💰 Valor: *${data.amount}*`);
      lines.push(`⏱️ Válido por *${data.expiresInMinutes} minutos*`);
      lines.push("");
      lines.push(SEP);
      lines.push("Após o pagamento, envio a confirmação");
      lines.push("automaticamente aqui no WhatsApp! ✅");
      lines.push(SEP);
      lines.push("");
      lines.push("⚠️ _Não compartilhe este link_");
      break;

    case "credit_card":
      lines.push("💳 *Pagamento via Cartão*");
      lines.push("");
      lines.push("Clique no link para inserir os dados do cartão:");
      lines.push(`🔗 ${data.url}`);
      lines.push("");
      lines.push(`💰 Valor: *${data.amount}*`);
      lines.push(`⏱️ Link válido por *${data.expiresInMinutes} minutos*`);
      lines.push(`🔒 Pagamento seguro via ${data.gateway ?? "gateway"} (SSL)`);
      lines.push("");
      lines.push(SEP);
      lines.push("Após a confirmação, envio o recibo aqui! ✅");
      lines.push(SEP);
      break;

    case "boleto":
      lines.push("🏦 *Boleto Bancário*");
      lines.push("");
      lines.push("Clique para visualizar/pagar:");
      lines.push(`🔗 ${data.url}`);
      lines.push("");
      lines.push(`💰 Valor: *${data.amount}*`);
      lines.push(`📅 Vencimento: *${data.expiresInMinutes} minutos*`);
      lines.push("");
      lines.push("⚠️ _O boleto pode levar até 3 dias úteis para compensar_");
      break;
  }

  return lines.join("\n");
}

/**
 * T11: Offer Applied — discount confirmed
 * Maps to Widget OfferBanner
 */
export function renderOfferApplied(data: WaOfferData): string {
  const lines: string[] = [];

  lines.push("🏷️ *Oferta especial aplicada!*");
  lines.push("");
  lines.push(`${data.discountLabel} no seu pedido`);
  lines.push(data.savingsLabel);
  lines.push("");
  lines.push(`🛒 Novo total: *${data.newTotal}*`);

  if (data.freeShipping) {
    lines.push("📦 Frete: *Grátis* ✨");
  }

  lines.push("");

  const options = ["Aceitar oferta e finalizar", "Continuar comprando", "Recusar oferta"];
  lines.push(renderNumberedMenu(options, false));

  return lines.join("\n");
}

/**
 * T12: Data Collection Prompt — ask buyer for personal data
 * Maps to CheckoutExperience.stage === "data_collection"
 * NOTE: phone is PRE-FILLED from WhatsApp (skip). Only ask missing fields.
 */
export function renderDataCollectionPrompt(data: WaDataCollectionPromptData): string {
  const lines: string[] = [];

  switch (data.field) {
    case "nome":
      lines.push("📝 Qual seu *nome completo*?");
      break;
    case "email":
      lines.push("📧 Qual seu *email*?");
      lines.push("_Enviaremos o comprovante por lá_");
      break;
    case "cpf":
      lines.push("🆔 Qual seu *CPF*? (apenas números)");
      lines.push("_Necessário para nota fiscal_");
      break;
    case "telefone":
      lines.push("📱 Seu telefone para contato?");
      lines.push("_Usado para atualizações do pedido_");
      break;
    case "otp_email":
      lines.push("🔐 Digite o *código de verificação* enviado para seu email:");
      break;
    case "otp_sms":
      lines.push("🔐 Digite o *código SMS* enviado para seu celular:");
      break;
  }

  if (data.skippedFields?.length) {
    lines.push("");
    lines.push(`✅ _Já temos: ${data.skippedFields.join(", ")}_`);
  }

  lines.push("");
  lines.push(renderNumberedMenu(data.quickReplies, false));
  lines.push("");

  const hint: Record<string, string> = {
    nome: "_Digite seu nome_",
    email: "_Digite seu email_",
    cpf: "_Digite os 11 números_",
    telefone: "_Digite seu número_",
    otp_email: "_Digite o código de 6 dígitos_",
    otp_sms: "_Digite o código de 6 dígitos_",
  };
  lines.push(hint[data.field] ?? "");

  return lines.join("\n");
}

/**
 * T13: Shipping Prompt — address collection steps
 * Maps to CheckoutExperience.stage === "shipping"
 */
export function renderShippingPrompt(data: WaShippingPromptData): string {
  const lines: string[] = [];

  switch (data.subField) {
    case "cep":
      lines.push("📍 Qual o *CEP* de entrega?");
      lines.push("");
      lines.push(renderNumberedMenu(data.quickReplies, false));
      lines.push("");
      lines.push("_Digite 8 números (ex: 01310100)_");
      break;

    case "confirmar":
      if (data.address) {
        lines.push("📍 Encontrei seu endereço:");
        lines.push(`*${data.address.street} — ${data.address.city}, ${data.address.state}*`);
        lines.push("");
        lines.push("Está correto?");
        lines.push("");
        lines.push(renderNumberedMenu(data.quickReplies, false));
      }
      break;

    case "numero":
      lines.push("🏠 Qual o *número*?");
      lines.push("");
      lines.push(renderNumberedMenu(data.quickReplies, false));
      break;

    case "complemento":
      lines.push("🏠 Tem *complemento*? (apto, bloco, ref)");
      lines.push("_Se não tem, responda \"não\"_");
      lines.push("");
      lines.push(renderNumberedMenu(data.quickReplies, false));
      break;

    case "frete":
      lines.push("📦 Calculando frete...");
      break;
  }

  return lines.join("\n");
}

/**
 * T14: Payment Summary — order review + payment method selection
 * Maps to CheckoutExperience.stage === "payment"
 */
export function renderPaymentSummary(data: WaPaymentSummaryData): string {
  const lines: string[] = [];

  lines.push("📋 *Resumo do Pedido*");
  lines.push(SEP);
  lines.push("");
  lines.push(`👤 ${data.customerName}`);
  lines.push(`📍 ${data.address}`);
  lines.push("");
  lines.push("🛒 *Itens:*");

  for (const item of data.items) {
    lines.push(`• ${item.quantity}x ${item.name}     ${item.lineTotal}`);
  }

  lines.push(SEP);
  lines.push(`Subtotal:     ${data.subtotal}`);
  lines.push(`Envio:        ${data.shipping}${data.shippingDetail ? ` (${data.shippingDetail})` : ""}`);

  if (data.discount) {
    lines.push(`Desconto:     -${data.discount}`);
  }

  lines.push(SEP);
  lines.push(`*💰 Total: ${data.total}*`);
  lines.push("");
  lines.push("Como deseja pagar?");
  lines.push("");
  lines.push(renderNumberedMenu(data.paymentOptions, false));

  return lines.join("\n");
}

/**
 * T15: Marketplace Products — items from partner stores
 * Maps to StorefrontMarketplaceProductsBlock
 */
export function renderMarketplaceProducts(data: WaMarketplaceData): string {
  const lines: string[] = [];

  lines.push("🏪 *Marketplace — Produtos de lojas parceiras*");
  lines.push("");

  data.products.slice(0, 5).forEach((p, i) => {
    lines.push(`${numberEmoji(i + 1)} ${p.name} — ${p.priceFormatted}`);
    lines.push(`    _por ${p.sellerName}_`);
  });

  lines.push("");
  if (data.hasMore) lines.push("⬇️ 6 — Carregar mais");
  lines.push("↩️ 0 — Voltar");
  lines.push("");
  lines.push("_Responda com o número_");

  return lines.join("\n");
}

// ─── Utility Templates ──────────────────────────────────────────────────────

/**
 * Error/Validation message
 */
export function renderValidationError(field: string, message: string): string {
  return [
    `⚠️ ${message}`,
    "",
    `_Digite novamente ou responda 0 para voltar_`,
  ].join("\n");
}

/**
 * Session expired with cart recovery
 */
export function renderSessionExpired(hasCart: boolean, cartSummary?: string): string {
  const lines = ["👋 Olá de novo! Sua sessão anterior expirou."];

  if (hasCart && cartSummary) {
    lines.push("");
    lines.push("Gostaria de retomar de onde parou?");
    lines.push(`_${cartSummary}_`);
    lines.push("");
    const options = ["Retomar carrinho anterior", "Começar novo pedido"];
    lines.push(renderNumberedMenu(options, false));
  } else {
    lines.push("");
    lines.push("Como posso te ajudar?");
    lines.push("");
    const options = ["Ver Produtos", "Categorias", "Suporte"];
    lines.push(renderNumberedMenu(options, false));
  }

  return lines.join("\n");
}

/**
 * Not understood — fallback
 */
export function renderNotUnderstood(): string {
  return [
    "🤔 Não entendi sua mensagem.",
    "",
    "Você pode:",
    "1️⃣ Ver o cardápio",
    "2️⃣ Ver seu carrinho",
    "3️⃣ Falar com atendente",
    "",
    "_Ou tente reformular sua pergunta_",
  ].join("\n");
}

/**
 * Handoff to human
 */
export function renderHandoff(estimatedWait?: string): string {
  const lines = [
    "🙋 Entendi! Vou transferir você para um atendente.",
    "",
  ];

  if (estimatedWait) {
    lines.push(`Aguarde um momento, por favor.`);
    lines.push(`_Tempo médio de espera: ~${estimatedWait}_`);
  } else {
    lines.push("Aguarde um momento, por favor.");
  }

  return lines.join("\n");
}

/**
 * Processing indicator (sent when engine takes > 5s)
 */
export function renderProcessing(): string {
  return "⏳ Estou processando sua solicitação...";
}
