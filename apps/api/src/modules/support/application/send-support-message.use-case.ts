import { Inject, Injectable , Logger, Optional} from "@nestjs/common";
import { isSafeGeneratedMessage } from "@zyon/conversation-engine";
import type { SupportFaqItem, SupportTicketStatus } from "@zyon/shared-types";
import { faqLookup } from "./support-faq.service.js";
import { smartFallback } from "./support-fallback.service.js";
import { SupportHandoffService } from "./support-handoff.service.js";
import type { ChatCompletionPort } from "../domain/ports/chat-completion.port.js";
import { CHAT_COMPLETION_PORT } from "../domain/ports/chat-completion.port.js";
import { stripHtmlFromReply } from "../domain/services/sanitize-reply.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { QueryKnowledgeUseCase } from "../../knowledge-base/application/use-cases/query-knowledge.use-case.js";
import { BuyerOrderContextService } from "../../knowledge-base/application/services/buyer-order-context.service.js";

export interface SupportMessageInput {
  message: string;
  merchant_id: string;
  session_id?: string;
}

export interface SupportMessageContext {
  brandName?: string;
  faqItems?: SupportFaqItem[];
  buyerGlobalUserId?: string;
}

export interface SupportMessageOutput {
  reply: string;
  safe: boolean;
  handoff?: {
    ticketId: string;
    status: SupportTicketStatus;
  };
}

function needsHumanHandoff(text: string): boolean {
  return /n[aã]o sei|nao tenho certeza|suporte humano|equipe|entrar em contato|contatar o suporte/i.test(
    text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""),
  );
}

const BASE_SYSTEM_PROMPT = `Você é um assistente de suporte ao cliente de uma loja. Responda dúvidas sobre entrega, pagamento, devoluções e pedidos de forma objetiva e empática.

REGRA FUNDAMENTAL — NÃO INVENTE:
- Responda APENAS com base nas informações oficiais da loja fornecidas abaixo (FAQ e contexto da loja).
- Se a resposta NÃO estiver nas informações oficiais, diga que não tem essa informação e ofereça encaminhar para um atendente humano.
- NUNCA invente prazos, políticas, valores, fatos gerais ou dados que não foram fornecidos pela loja.
- Não responda perguntas fora do escopo de atendimento da loja (ex: curiosidades, esportes, notícias). Se perguntarem algo fora do escopo, redirecione educadamente para dúvidas sobre a loja e os pedidos.

PROIBIDO:
- Autorizar descontos, cupons ou promoções
- Confirmar ou negar status de pagamento
- Prometer prazos de entrega ou garantir disponibilidade de estoque (a menos que conste no FAQ oficial)
- Solicitar senha, CVV ou dados sensíveis
- Inventar informações que não foram fornecidas pela loja

Se não souber a resposta com certeza com base nas informações oficiais, oriente o cliente a contatar o suporte humano.`;

function buildSystemPrompt(ctx?: SupportMessageContext, knowledgeContext?: string): string {
  if (!ctx?.faqItems?.length && !ctx?.brandName && !knowledgeContext) return BASE_SYSTEM_PROMPT;

  const parts: string[] = [BASE_SYSTEM_PROMPT];

  if (ctx?.brandName) {
    parts.push(`\nCONTEXTO DA LOJA:\nNome: ${ctx.brandName}`);
  }

  if (knowledgeContext) {
    parts.push(
      `\nINFORMAÇÕES RELEVANTES DA BASE DE CONHECIMENTO:\n${knowledgeContext}\n\nUse as informações acima para responder à dúvida do cliente.`,
    );
  }

  if (ctx?.faqItems?.length) {
    const faqLines = ctx.faqItems
      .slice(0, 10)
      .map((f) => `P: ${f.question}\nR: ${f.answer}`)
      .join("\n\n");
    parts.push(
      `\nPERGUNTAS FREQUENTES CONFIGURADAS PELA LOJA (use como referência):\n${faqLines}\n\nSe a dúvida do cliente está coberta acima, responda com base nessas informações.`,
    );
  }

  return parts.join("\n");
}

/**
 * SUPP-H1 refactored: Now orchestrates FAQ lookup, OpenAI, fallback, and handoff.
 * Core logic extracted to support-faq.service, support-fallback.service, support-handoff.service.
 */
@Injectable()
export class SendSupportMessageUseCase {
  private readonly logger = new Logger(SendSupportMessageUseCase.name);

  constructor(
    @Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort,
    private readonly handoff: SupportHandoffService,
    @Optional() private readonly queryKnowledge?: QueryKnowledgeUseCase,
    @Optional() private readonly buyerOrderContext?: BuyerOrderContextService,
  ) {}

  async execute(
    input: SupportMessageInput,
    ctx?: SupportMessageContext,
  ): Promise<SupportMessageOutput> {
    // FAQ lookup first (fastest path)
    const faqReply = faqLookup(input.message, ctx?.faqItems ?? []);
    if (faqReply) return { reply: faqReply, safe: true };

    // Query knowledge base (RAG)
    let knowledgeContext: string | undefined;
    if (this.queryKnowledge) {
      try {
        const result = await this.queryKnowledge.execute({
          merchantId: input.merchant_id,
          queryText: input.message,
          limit: 5,
          threshold: 0.65,
        });

        if (result.chunks.length > 0) {
          knowledgeContext = result.chunks
            .map((chunk) => `• ${chunk.content}`)
            .join("\n\n");
        }
      } catch (err) {
        this.logger.warn(`Knowledge base query failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Buyer-specific order context (only if buyer is identified)
    if (this.buyerOrderContext && ctx?.buyerGlobalUserId) {
      try {
        const orderContext = await this.buyerOrderContext.getRecentOrdersContext(
          input.merchant_id,
          ctx.buyerGlobalUserId,
        );
        if (orderContext) {
          knowledgeContext = (knowledgeContext ? `${knowledgeContext}\n\n` : "")
            + `PEDIDOS RECENTES DO CLIENTE:\n${orderContext}`;
        }
      } catch (err) {
        this.logger.warn(`Buyer order context failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // OpenAI (configured?)
    const systemPrompt = buildSystemPrompt(ctx, knowledgeContext);
    const rawReply = await this.chat.complete([
      { role: "system", content: systemPrompt },
      { role: "user", content: input.message },
    ]);
    // SUPP-H5: Strip HTML from AI reply (defense-in-depth against XSS)
    const aiReply = rawReply ? stripHtmlFromReply(rawReply) : null;

    if (!aiReply || !isSafeGeneratedMessage(aiReply)) {
      // Unsafe or no response → handoff with fallback
      const result = await this.handoff.createHandoff(
        { merchantId: input.merchant_id, sessionId: input.session_id, buyerMessage: input.message },
        aiReply ? undefined : smartFallback(input.message),
      );
      return {
        reply: result.reply,
        safe: !!aiReply,
        handoff: { ticketId: result.ticketId, status: "open" },
      };
    }

    // Safe AI reply — but does it request handoff?
    if (needsHumanHandoff(aiReply)) {
      const result = await this.handoff.createHandoff(
        { merchantId: input.merchant_id, sessionId: input.session_id, buyerMessage: input.message },
        aiReply,
      );
      return {
        reply: result.reply,
        safe: true,
        handoff: { ticketId: result.ticketId, status: "open" },
      };
    }

    // Safe AI reply, no handoff needed
    return { reply: aiReply, safe: true };
  }
}
