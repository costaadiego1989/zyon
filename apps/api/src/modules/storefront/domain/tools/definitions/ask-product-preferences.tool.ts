import type { ToolDefinition } from "../types.js";

/** Conversational output only; no handler, database or commerce mutation. The
 * agent consumes this tool locally and completes the turn in one model call. */
export const ASK_PRODUCT_PREFERENCES: ToolDefinition = {
  name: "ask_product_preferences",
  description: "Faça UMA pergunta útil de descoberta antes de recomendar, quando falta um dado que muda a escolha. Devolva a frase completa e até 4 respostas curtas que respondam exatamente à pergunta (ou [] se for aberta). Não ofereça ações de carrinho/checkout. Até 3 rodadas, sem repetir dados do histórico. Não use para navegação, produto já escolhido ou informações suficientes.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "Texto natural completo, no idioma da conversa, com uma única pergunta ao final.", maxLength: 500 },
      replies: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4, uniqueItems: true },
    },
    required: ["question", "replies"],
  },
};
