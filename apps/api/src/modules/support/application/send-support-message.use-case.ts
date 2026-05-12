import { Injectable, Optional } from "@nestjs/common";
import { isSafeGeneratedMessage } from "@aacp/conversation-engine";
import type { SupportFaqItem } from "@aacp/shared-types";
import { HttpClientService } from "../../../shared/http/http-client.service.js";

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
  constructor(@Optional() private readonly http?: HttpClientService) {}

  async execute(
    input: SupportMessageInput,
    ctx?: SupportMessageContext,
  ): Promise<SupportMessageOutput> {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

    if (!apiKey) {
      const faqReply = faqLookup(input.message, ctx?.faqItems ?? []);
      return { reply: faqReply ?? smartFallback(input.message), safe: true };
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
        return { reply: smartFallback(input.message), safe: true };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";

      if (!text || !isSafeGeneratedMessage(text)) {
        return { reply: smartFallback(input.message), safe: false };
      }

      return { reply: text, safe: true };
    } catch {
      return { reply: smartFallback(input.message), safe: true };
    }
  }
}
