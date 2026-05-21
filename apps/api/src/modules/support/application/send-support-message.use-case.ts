import { Inject, Injectable, Optional } from "@nestjs/common";
import { isSafeGeneratedMessage } from "@aacp/conversation-engine";
import type { SupportFaqItem, SupportTicket, SupportTicketStatus } from "@aacp/shared-types";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository
} from "../domain/ports/support-ticket-repository.port.js";

export interface SupportMessageInput {
  message: string;
  merchant_id: string;
  session_id?: string;
}

export interface SupportMessageContext {
  brandName?: string;
  faqItems?: SupportFaqItem[];
}

export interface SupportMessageOutput {
  reply: string;
  safe: boolean;
  handoff?: {
    ticketId: string;
    status: SupportTicketStatus;
  };
}

function smartFallback(text: string): string {
  const t = text.toLowerCase();
  if (/(frete|entrega|prazo|rastreio|rastreamento)/.test(t))
    return "Para dúvidas sobre frete e prazo, consulte o rastreamento no e-mail de confirmação do pedido.";
  if (/(troca|devolu|reembolso|cancelamento|cancelar)/.test(t))
    return "Trocas e devoluções podem ser solicitadas em até 7 dias pelo e-mail de atendimento da loja.";
  if (/(pagamento|cartão|cartao|pix|boleto|recusado|cobrado)/.test(t))
    return "Para problemas com pagamento, verifique seu extrato ou entre em contato com o banco emissor.";
  if (/(produto|item|estoque|disponível|disponivel|esgotado)/.test(t))
    return "Para informações sobre disponibilidade de produto, acesse o site da loja.";
  if (/(cupom|desconto|promoção|promocao|oferta)/.test(t))
    return "Cupons são aplicados durante o checkout. Verifique se o código está correto e dentro do prazo de validade.";
  if (/(conta|senha|login|acesso|cadastro)/.test(t))
    return "Para problemas de acesso à conta, use a opção 'Esqueci minha senha' na página de login.";
  return "Entendo sua dúvida. Nossa equipe responde em até 24h — envie um e-mail para o suporte da loja.";
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function faqLookup(message: string, items: SupportFaqItem[]): string | null {
  if (!items.length) return null;
  const q = normalize(message);
  let bestMatch: { answer: string; score: number } | null = null;
  for (const item of items) {
    const keywords = normalize(item.question).split(/\W+/).filter((k) => k.length > 3);
    const score = keywords.filter((k) => q.includes(k)).length;
    if (score >= 2 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { answer: item.answer, score };
    }
  }
  return bestMatch?.answer ?? null;
}

function needsHumanHandoff(text: string): boolean {
  return /n[aã]o sei|nao tenho certeza|suporte humano|equipe|entrar em contato|contatar o suporte/i.test(
    normalize(text),
  );
}

function formatHandoffReply(ticket: SupportTicket, contextReply?: string): string {
  const prefix = contextReply?.trim() ? `${contextReply.trim()}\n\n` : "";
  return `${prefix}Tambem abri um chamado para a equipe da loja acompanhar de perto. Protocolo: ${ticket.id}.`;
}

const BASE_SYSTEM_PROMPT = `Você é um assistente de suporte ao cliente. Responda dúvidas sobre entrega, pagamento, devoluções e pedidos de forma objetiva e empática.

PROIBIDO:
- Autorizar descontos, cupons ou promoções
- Confirmar ou negar status de pagamento
- Prometer prazos de entrega ou garantir disponibilidade de estoque
- Solicitar senha, CVV ou dados sensíveis

Se não souber a resposta com certeza, oriente o cliente a contatar o suporte humano.`;

function buildSystemPrompt(ctx?: SupportMessageContext): string {
  if (!ctx?.faqItems?.length && !ctx?.brandName) return BASE_SYSTEM_PROMPT;

  const parts: string[] = [BASE_SYSTEM_PROMPT];

  if (ctx.brandName) {
    parts.push(`\nCONTEXTO DA LOJA:\nNome: ${ctx.brandName}`);
  }

  if (ctx.faqItems?.length) {
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

@Injectable()
export class SendSupportMessageUseCase {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY)
    private readonly tickets: SupportTicketRepository,
    @Optional() private readonly http?: HttpClientService,
  ) {}

  async execute(
    input: SupportMessageInput,
    ctx?: SupportMessageContext,
  ): Promise<SupportMessageOutput> {
    const faqReply = faqLookup(input.message, ctx?.faqItems ?? []);
    if (faqReply) return { reply: faqReply, safe: true };

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

    if (!apiKey) {
      return this.createHandoff(input, true, smartFallback(input.message));
    }

    try {
      const fetchFn = this.http?.toFetch() ?? fetch;
      const response = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: buildSystemPrompt(ctx) },
            { role: "user", content: input.message },
          ],
          max_tokens: 300,
          temperature: 0.4,
        }),
      });

      if (!response.ok) {
        return this.createHandoff(input, true, smartFallback(input.message));
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";

      if (!text || !isSafeGeneratedMessage(text)) {
        return this.createHandoff(input, false, smartFallback(input.message));
      }

      if (needsHumanHandoff(text)) {
        return this.createHandoff(input, true, text);
      }

      return { reply: text, safe: true };
    } catch {
      return this.createHandoff(input, true, smartFallback(input.message));
    }
  }

  private async createHandoff(
    input: SupportMessageInput,
    safe: boolean,
    contextReply?: string,
  ): Promise<SupportMessageOutput> {
    const ticket = await this.tickets.save(
      SupportTicketEntity.create({
        merchantId: input.merchant_id,
        sessionId: input.session_id,
        buyerMessage: input.message,
        source: "widget",
      }).snapshot(),
    );
    return {
      reply: formatHandoffReply(ticket, contextReply),
      safe,
      handoff: {
        ticketId: ticket.id,
        status: ticket.status,
      },
    };
  }
}
