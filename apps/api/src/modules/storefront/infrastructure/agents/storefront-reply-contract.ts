import type { OpenRouterChatMessage } from "@zyon/conversation-engine";

/** Restate transport after the conversation and any tool results. Historical
 * assistant prose stays unchanged; this never repairs or retries model output. */
export const STOREFRONT_REPLY_CONTRACT_REMINDER = 'CONTRATO DE TRANSPORTE: quando a resposta não chamar ferramentas, retorne somente um objeto JSON válido no formato {"schemaVersion":1,"message":"texto para o comprador"}. A fala natural e a formatação para o cliente ficam dentro de message. Não retorne fala solta, cercas markdown, explicações ou campos extras fora desse objeto. Este lembrete não autoriza nenhuma ação comercial.';

export function withStorefrontReplyContract(messages: OpenRouterChatMessage[]): OpenRouterChatMessage[] {
  return [...messages.filter((message, index) => index === 0 || message.role !== "system"
    || message.content !== STOREFRONT_REPLY_CONTRACT_REMINDER),
  { role: "system", content: STOREFRONT_REPLY_CONTRACT_REMINDER }];
}
