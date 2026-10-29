import type { StorefrontConversationInput, StorefrontConversationOutput } from "../../domain/ports/conversation.port.js";
import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";
import { callStorefrontTool } from "../../domain/tools/call-storefront-tool.js";
import { buildConversationBlocks } from "../agents/conversation-block.builder.js";
import { resolveNativeShippingReference } from "../agents/native-shipping-reference.js";
import { shippingReferenceCepSchema } from "../../domain/contracts/storefront-shipping-reference.schemas.js";

export const SHIPPING_CEP_PROMPT = "Qual é o CEP de entrega? Envie somente o CEP para consultar as opções do seu carrinho. O prazo e o valor serão confirmados na cotação.";
export const SHIPPING_CEP_INVALID_PROMPT = "*Confira o CEP*\n\nO CEP precisa ter 8 dígitos. Pode enviá-lo com ou sem hífen.\n\n" + SHIPPING_CEP_PROMPT;
export const SUPPORT_REPORT_PROMPT = "Descreva o problema com a loja ou seu pedido em uma mensagem. Vou registrar a descrição para a equipe da loja. Não envie senhas ou dados bancários.";
export const ORDER_NUMBER_PROMPT = "Qual é o número do pedido que você quer consultar?";

const SUPPORT_REPLIES = ["FAQ", "Falar com Humano", "Reportar Problema", "Status do Pedido", "Voltar ao Início"];
const ACTIONS = new Map([
  ["meus dados", "profile"], ["falar com humano", "human"],
  ["reportar problema", "report"], ["status do pedido", "order"], ["rastrear pedido", "order"],
  ["voltar ao início", "home"],
  ["ofertas", "deals"], ["ofertas do dia", "deals"],
  ["encontrar produto", "find"], ["selecionar produto", "select"],
  ["filtrar produtos", "filter"], ["tirar dúvidas", "questions"],
  ["prazo de entrega", "shipping"],
] as const);

/** These are complete application-owned navigation labels, not semantic matches.
 * Attachments and arbitrary prose still pass through the normal domain gate. */
export async function resolveSupportNavigation(
  input: StorefrontConversationInput,
  getHandlers: () => StoreToolHandlers,
): Promise<StorefrontConversationOutput | null> {
  if (input.attachmentContext || input.uiAction) return null;
  const action = ACTIONS.get(input.userMessage.trim().toLowerCase() as Parameters<typeof ACTIONS.get>[0]);
  const previous = input.history.slice().reverse().find(turn => turn.role === "assistant");
  const orderNumber = !action && previous?.content === ORDER_NUMBER_PROMPT
    && /^[\p{L}\p{N}_-]{3,200}$/u.test(input.userMessage.trim()) ? input.userMessage.trim() : undefined;
  const reporting = !action && previous?.content === SUPPORT_REPORT_PROMPT && input.userMessage.trim().length > 0 && input.userMessage.length <= 2000;
  const pendingCep = [SHIPPING_CEP_PROMPT, SHIPPING_CEP_INVALID_PROMPT].includes(previous?.content ?? "")
    ? shippingReferenceCepSchema.safeParse(input.userMessage.trim()) : undefined;
  const invalidCep = pendingCep && !pendingCep.success && /^[\d\s.-]{1,30}$/.test(input.userMessage.trim());
  if (!action && !pendingCep?.success && !invalidCep && !reporting && !orderNumber) return null;
  const output = (message: string, suggestedNext = SUPPORT_REPLIES): StorefrontConversationOutput => ({
    message: message.slice(0, 7900), blocks: [], cartId: input.cartId || input.sessionId, suggestedNext,
  });
  if (invalidCep && !action) return output(SHIPPING_CEP_INVALID_PROMPT, []);
  if (action === "find") return output("Qual produto você procura? Diga o nome, tipo ou o que você precisa.", []);
  if (action === "select") return output("Qual produto você quer conhecer melhor? Diga o nome ou escolha um dos produtos apresentados.", []);
  if (action === "filter") return output("Qual critério você quer usar para filtrar os produtos? Pode me dizer a faixa de preço ou uma característica importante.", []);
  if (action === "questions") return output("Qual é a sua dúvida sobre o produto?", []);
  if (action === "report") return output(SUPPORT_REPORT_PROMPT, ["Falar com Humano", "Voltar ao Início"]);
  if (pendingCep?.success && !action) {
    return await resolveNativeShippingReference({ ...input, userMessage: `Calcular frete para seu carrinho CEP ${pendingCep.data}` }, getHandlers().quoteShipping) ?? null;
  }
  if (action === "home") return output("Como posso ajudar você nesta loja?", ["Ver Produtos", "Categorias", "Meus Dados", "Suporte"]);
  if (action === "order") return output(input.buyerContext?.globalUserId
    ? ORDER_NUMBER_PROMPT
    : "Para consultar o status do seu pedido, entre na sua conta em Meus Dados e abra Pedidos ou Rastreio.",
    ["Meus Dados", "Falar com Humano", "FAQ", "Voltar ao Início"]);
  try {
    const handlers = getHandlers();
    if (orderNumber) {
      const args = { orderId: orderNumber };
      const checked = await callStorefrontTool("track_order", args, () => handlers.trackOrder(args));
      if (!checked.ok) return output("Não consegui consultar esse pedido agora. Tente novamente em instantes.");
      const tracking = checked.data as { message?: string; statusLabel?: string };
      const built = buildConversationBlocks({ merchantId: input.merchantId, userMessage: input.userMessage,
        finalContent: tracking.message ?? tracking.statusLabel ?? "Confira a situação do pedido.", toolResults: { track_order: checked.data } });
      return { ...output(built.finalContent), blocks: built.blocks };
    }
    if (action === "shipping") {
      const args = { cartId: input.cartId || input.sessionId };
      const checked = await callStorefrontTool("get_cart", args, () => handlers.getCart(args), { cartId: args.cartId });
      if (!checked.ok) return output("Não consegui consultar o carrinho agora. Tente novamente em instantes.", ["Ver Carrinho"]);
      return (checked.data as { items: unknown[] }).items.length
        ? output(SHIPPING_CEP_PROMPT, [])
        : output("Adicione um produto ao carrinho para consultar as opções e o prazo de entrega para seu CEP.", ["Ver Produtos", "Ver Carrinho"]);
    }
    if (action === "deals") {
      const args = { limit: 6 };
      const checked = await callStorefrontTool("get_daily_deals", args, () => handlers.getDailyDeals(args));
      if (!checked.ok) return output("Não consegui consultar as ofertas agora. Tente novamente em instantes.", ["Ver Produtos", "Suporte"]);
      const built = buildConversationBlocks({ merchantId: input.merchantId, userMessage: input.userMessage,
        finalContent: "", toolResults: { get_daily_deals: checked.data } });
      return { ...output(built.blocks.length ? "Estas são as ofertas ativas da loja. Confira os preços e condições nos produtos."
        : "No momento não há ofertas ativas. Posso mostrar os produtos da loja?", ["Ver Produtos", "Categorias", "Suporte"]), blocks: built.blocks };
    }
    if (action === "profile") {
      const checked = await callStorefrontTool("get_buyer_profile", {}, () => handlers.getBuyerProfile());
      return output(checked.ok ? (checked.data as { message: string }).message : "Não consegui consultar seu perfil agora. Tente novamente em Meus Dados.");
    }
    const reason = reporting ? input.userMessage.trim() : "Solicitação de atendimento humano";
    const checked = await callStorefrontTool("escalate_to_human", { reason }, () => handlers.escalateToHuman({ reason }));
    if (!checked.ok) return output("Não consegui confirmar a abertura do atendimento. Tente novamente pela Central de Ajuda.");
    const handoff = checked.data as { message: string; ticketId: string };
    return output(`${handoff.message}\n\nProtocolo: ${handoff.ticketId}.${reporting
      ? " Sua descrição foi registrada. Acompanhe as respostas em Meus Dados, na aba Conversas."
      : " Você pode acompanhar o atendimento em Meus Dados, na aba Conversas."}`,
    ["Meus Dados", "FAQ", "Status do Pedido", "Voltar ao Início"]);
  } catch {
    // A handoff may already have persisted. Never claim success or retry a write.
    return output("Não consegui confirmar o resultado do atendimento agora. Consulte a Central de Ajuda antes de tentar novamente.");
  }
}
