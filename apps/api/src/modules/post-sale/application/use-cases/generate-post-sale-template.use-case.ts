import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PostSaleAiCopywriterService } from "../services/post-sale-ai-copywriter.service.js";

export interface GeneratePostSaleTemplateInput {
  type: "follow_up" | "review_request" | "nps" | "cross_sell" | "win_back" | "loyalty" | "reorder";
  channel: string;
  tone?: string;
  storeName: string;
}

export interface GeneratePostSaleTemplateOutput {
  name: string;
  body: string;
  subject?: string;
}

@Injectable()
export class GeneratePostSaleTemplateUseCase {
  private readonly logger = new Logger(GeneratePostSaleTemplateUseCase.name);

  constructor(private readonly copywriter: PostSaleAiCopywriterService) {}

  async execute(input: GeneratePostSaleTemplateInput): Promise<GeneratePostSaleTemplateOutput> {
    const tone = input.tone || "warm and engaging";
    const typeDescriptions: Record<string, string> = {
      follow_up: "A follow-up message after delivery to check if the customer is happy",
      review_request: "A review request asking for feedback on a product",
      nps: "An NPS survey asking customers to rate 0-10 how likely they'd recommend",
      cross_sell: "A cross-sell message suggesting complementary products",
      win_back: "A win-back message for inactive customers with an incentive",
      loyalty: "A loyalty message congratulating on a purchase milestone",
      reorder: "A reorder reminder for consumable products",
    };

    const prompt = `Generate a professional post-sale WhatsApp message for the following scenario:

Type: ${input.type} (${typeDescriptions[input.type] || ""})
Store: {{storeName}} (use this placeholder)
Buyer: {{buyerName}} (use this placeholder)
Product: {{productName}} (use this placeholder)
Link: {{link}} (use this placeholder for action links)
Tone: ${tone}

Rules:
- Keep it concise and friendly
- Use Portuguese (pt-BR)
- Include call-to-action where appropriate
- Never guarantee discounts, free shipping, or request sensitive data
- Use emojis naturally (max 3)
- Structure for WhatsApp (keep under 300 chars if possible, but can be longer for complex messages)

Respond with only the message text, no explanations.`;

    try {
      const body = await this.copywriter.generateWithAi(prompt);

      // Derive name from type
      const names: Record<string, string> = {
        follow_up: "Follow-up de Entrega",
        review_request: "Pedido de Avaliação",
        nps: "Pesquisa NPS",
        cross_sell: "Cross-sell",
        win_back: "Win-back",
        loyalty: "Benefício de Fidelidade",
        reorder: "Recompra",
      };

      const subject = input.channel === "email" ? `Mensagem de ${names[input.type]}` : undefined;

      return {
        name: names[input.type],
        body,
        subject,
      };
    } catch (err) {
      this.logger.error(`Template generation failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException("ai_generation_failed");
    }
  }
}
