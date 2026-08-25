import { Injectable, Logger } from "@nestjs/common";
import { isSafeGeneratedMessage } from "../../../checkout/domain/types/safe-generated-message.js";

export interface GenerateMessageInput {
  type: "follow_up" | "review_request" | "nps" | "cross_sell" | "win_back" | "loyalty" | "reorder";
  buyerName: string;
  productName: string;
  merchantId: string;
  buyerId: string;
}

@Injectable()
export class PostSaleAiCopywriterService {
  private readonly logger = new Logger(PostSaleAiCopywriterService.name);

  async generate(input: GenerateMessageInput): Promise<string> {
    const template = this.getTemplate(input.type, input.buyerName, input.productName);

    // Try LLM if API key available
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const llmMessage = await this.generateWithLLM(input, template, apiKey);
        const safety = isSafeGeneratedMessage(llmMessage);
        if (safety.safe) {
          return llmMessage;
        }
        this.logger.warn(
          `LLM message failed safety check: ${safety.reason}`,
          { merchantId: input.merchantId, type: input.type }
        );
      } catch (err) {
        this.logger.error(
          `LLM call failed, falling back to template`,
          {
            error: err instanceof Error ? err.message : String(err),
            merchantId: input.merchantId,
            type: input.type,
          }
        );
      }
    }

    // Fallback to template
    return template;
  }

  private async generateWithLLM(
    input: GenerateMessageInput,
    fallback: string,
    apiKey: string
  ): Promise<string> {
    const prompt = this.buildPrompt(input, fallback);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content:
              "You are a friendly e-commerce post-sale messaging expert. Generate warm, personalized WhatsApp-style messages in Portuguese. Be concise, authentic, and never claim unauthorized discounts or guarantees. Always validate that the message is safe and does not mislead the buyer.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const message = data.choices?.[0]?.message?.content?.trim() || fallback;
    return message;
  }

  private buildPrompt(input: GenerateMessageInput, fallback: string): string {
    const contexts: Record<string, string> = {
      follow_up:
        "The buyer just received their order. Ask them how it went and if they need any help.",
      review_request:
        "It's been 3 days since delivery. Ask them to leave a review, mention a small incentive (e.g., discount on next purchase).",
      nps: "Ask the buyer to rate their experience from 0-10 with the store.",
      cross_sell:
        "Suggest complementary products based on what they bought. Be subtle, not pushy.",
      win_back: "The buyer hasn't purchased in 30+ days. Welcome them back with a special offer.",
      loyalty: "Congratulate the buyer on reaching a purchase milestone.",
      reorder: "The buyer bought a consumable product. Remind them it might be time to reorder.",
    };

    return `
Generate a brief, friendly WhatsApp message in Portuguese for this scenario:
- Buyer: ${input.buyerName}
- Product: ${input.productName}
- Type: ${input.type}
- Context: ${contexts[input.type]}

Fallback if you can't generate: "${fallback}"

Important:
- Keep it under 120 characters
- No unauthorized offers (no "I'm giving you X%", no "free shipping guaranteed", etc.)
- Sound like a friendly person, not corporate
- Use casual Portuguese (pt-BR)
- Never ask for sensitive data (CVV, password, etc.)
`;
  }

  private getTemplate(
    type: string,
    buyerName: string,
    productName: string
  ): string {
    const templates: Record<string, string> = {
      follow_up: `Oi ${buyerName}! 👋 Tudo bem com seu pedido? O ${productName} chegou certinho?`,
      review_request: `${buyerName}, você curtiu o ${productName}? Deixa sua avaliação pra gente! ⭐`,
      nps: `De 0 a 10, quanto recomendaria a gente pro seu amigo?`,
      cross_sell: `${buyerName}, veja esses produtos que combinam com sua compra! 🎁`,
      win_back: `Que saudade, ${buyerName}! Temos novidades pra você. 💝`,
      loyalty: `Parabéns pela sua ${productName}ª compra, ${buyerName}! 🎉`,
      reorder: `${buyerName}, chegou a hora de repor o ${productName}?`,
    };

    return templates[type] || `Oi ${buyerName}!`;
  }
}
