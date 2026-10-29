import type { StorefrontConversationInput, StorefrontConversationOutput } from "../../domain/ports/conversation.port.js";
import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";
import { callStorefrontTool } from "../../domain/tools/call-storefront-tool.js";
import { buildConversationBlocks } from "../agents/conversation-block.builder.js";

const SUPPORT_REPLIES = ["FAQ", "Falar com Humano", "Reportar Problema", "Status do Pedido", "Voltar ao Início"];
const ACTIONS = new Map([
  ["meus dados", "profile"], ["faq", "faq"], ["falar com humano", "human"],
  ["reportar problema", "report"], ["status do pedido", "order"], ["rastrear pedido", "order"],
  ["suporte", "support"], ["voltar ao início", "home"],
  ["ofertas", "deals"], ["ofertas do dia", "deals"],
] as const);

/** These are complete application-owned navigation labels, not semantic matches.
 * Attachments and arbitrary prose still pass through the normal domain gate. */
export async function resolveSupportNavigation(
  input: StorefrontConversationInput,
  getHandlers: () => StoreToolHandlers,
): Promise<StorefrontConversationOutput | null> {
  if (input.attachmentContext || input.uiAction) return null;
  const action = ACTIONS.get(input.userMessage.trim().toLowerCase() as Parameters<typeof ACTIONS.get>[0]);
  if (!action) return null;
  const output = (message: string, suggestedNext = SUPPORT_REPLIES): StorefrontConversationOutput => ({
    message: message.slice(0, 7900), blocks: [], cartId: input.cartId || input.sessionId, suggestedNext,
  });
  if (action === "home") return output("Como posso ajudar você nesta loja?", ["Ver Produtos", "Categorias", "Meus Dados", "Suporte"]);
  if (action === "support") return output("Escolha como posso ajudar com o atendimento desta loja.");
  if (action === "order") return output(input.buyerContext?.globalUserId
    ? "Qual é o número do pedido que você quer consultar?"
    : "Para consultar o status do seu pedido, entre na sua conta em Meus Dados e abra Pedidos ou Rastreio.",
    ["Meus Dados", "Falar com Humano", "FAQ", "Voltar ao Início"]);
  try {
    const handlers = getHandlers();
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
    if (action === "faq") {
      const checked = await callStorefrontTool("get_faq", {}, () => handlers.getFaq({}));
      if (!checked.ok) return output("Não consegui consultar as perguntas frequentes agora. Tente novamente ou fale com o atendimento.");
      const faqs = (checked.data as { faqs: Array<{ question: string; answer: string }> }).faqs.slice(0, 8);
      return output(faqs.length ? "Perguntas frequentes desta loja:\n\n" + faqs.map(faq => `${faq.question}\n${faq.answer}`).join("\n\n")
        : "A loja ainda não cadastrou perguntas frequentes. Você pode falar com o atendimento.");
    }
    const reason = action === "report" ? "Reportar problema com a loja ou um pedido" : "Solicitação de atendimento humano";
    const checked = await callStorefrontTool("escalate_to_human", { reason }, () => handlers.escalateToHuman({ reason }));
    if (!checked.ok) return output("Não consegui confirmar a abertura do atendimento. Tente novamente pela Central de Ajuda.");
    const handoff = checked.data as { message: string; ticketId: string };
    return output(`${handoff.message}\n\nProtocolo: ${handoff.ticketId}.${action === "report"
      ? " Descreva o problema e informe o número do pedido, se houver, para a equipe analisar."
      : " Você pode acompanhar o atendimento em Meus Dados, na aba Conversas."}`,
    ["Meus Dados", "FAQ", "Status do Pedido", "Voltar ao Início"]);
  } catch {
    // A handoff may already have persisted. Never claim success or retry a write.
    return output("Não consegui confirmar o resultado do atendimento agora. Consulte a Central de Ajuda antes de tentar novamente.");
  }
}
