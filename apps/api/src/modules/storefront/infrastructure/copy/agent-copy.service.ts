import type { OpenRouterProvider } from "@zyon/conversation-engine";
import type { NudgeCopyInput } from "../../domain/ports/conversation.port.js";

export class AgentCopyService {
  constructor(private readonly copyProvider: OpenRouterProvider) {}

  async generateVariantCopy(
    experimentSystemPrompt: string | undefined,
    instruction: string,
    fallback: string,
  ): Promise<string> {
    if (!experimentSystemPrompt) return fallback;
    try {
      const result = await this.copyProvider.chat({
        messages: [
          { role: "system", content: experimentSystemPrompt },
          { role: "user", content: instruction },
        ],
        temperature: 0.7,
        maxTokens: 60,
      });
      const text = result.content?.trim();
      return text && text.length > 0 ? text : fallback;
    } catch {
      return fallback;
    }
  }

  async generateNudge(input: NudgeCopyInput): Promise<string> {
    const style = input.experimentSystemPrompt || (input.agentTone ? `Tom de comunicação: ${input.agentTone}. Seja persuasiva e vendedora.` : undefined);
    if (!style) return input.fallback;

    const offersBlock = input.availableOffers.length > 0
      ? `Benefícios REAIS que você PODE mencionar (use no máximo um, o mais relevante): ${input.availableOffers.join("; ")}.`
      : "NÃO há nenhum desconto, cupom, frete grátis ou oferta disponível. NÃO prometa nem invente nenhum benefício, desconto ou frete. Apenas ofereça ajuda para escolher o produto.";

    const moment = input.trigger === "exit_intent_detected" ? "está saindo da loja" : "está parado na loja há um tempo, indeciso";
    const situation = input.stage === "cart"
      ? `O comprador tem itens no carrinho e ${moment}. Foque em fechar a compra agora.`
      : `O comprador ${moment} e ainda não tem itens no carrinho. Foque em ajudá-lo a escolher e avançar.`;

    const instruction = [
      situation,
      offersBlock,
      "Escreva UMA frase curta (máx 18 palavras) que o leve a agir agora, falando em primeira pessoa direto ao comprador.",
      "Regra absoluta: só cite um benefício se ele estiver listado acima; nunca invente desconto, cupom ou frete. Só a frase, sem aspas, sem perguntar 'como posso ajudar'.",
    ].join(" ");

    return this.generateVariantCopy(style, instruction, input.fallback);
  }
}
