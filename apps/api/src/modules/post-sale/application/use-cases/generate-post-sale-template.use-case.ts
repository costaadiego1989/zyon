import { Injectable, Logger } from "@nestjs/common";
import { PostSaleAiCopywriterService, type GenerateMessageInput } from "../services/post-sale-ai-copywriter.service.js";

export interface GeneratePostSaleTemplateInput {
  type: "follow_up" | "review_request" | "nps" | "cross_sell" | "win_back" | "loyalty" | "reorder";
  channel: string;
  tone?: string;
  storeName: string;
}

export interface GeneratePostSaleTemplateOutput {
  name: string;
  /** Freeform body for email + inside the 24h WhatsApp session window. */
  body: string;
  subject?: string;
  /** Meta/Twilio positional template for business-initiated WhatsApp. */
  meta: {
    metaBody: string;
    variableMap: Record<string, string>;
    sampleVariables: Record<string, string>;
    category: "UTILITY" | "MARKETING";
    language: string;
  };
}

const NAMES: Record<string, string> = {
  follow_up: "Follow-up de Entrega",
  review_request: "Pedido de Avaliação",
  nps: "Pesquisa NPS",
  cross_sell: "Cross-sell",
  win_back: "Win-back",
  loyalty: "Benefício de Fidelidade",
  reorder: "Recompra",
};

@Injectable()
export class GeneratePostSaleTemplateUseCase {
  private readonly logger = new Logger(GeneratePostSaleTemplateUseCase.name);

  constructor(private readonly copywriter: PostSaleAiCopywriterService) {}

  async execute(input: GeneratePostSaleTemplateInput): Promise<GeneratePostSaleTemplateOutput> {
    const type = input.type as GenerateMessageInput["type"];

    // 1) Freeform body — try AI, fall back to the platform default template.
    let freeform: string;
    try {
      const tone = input.tone || "warm and engaging";
      const prompt = this.buildFreeformPrompt(type, input.storeName, tone);
      freeform = await this.copywriter.generateWithAi(prompt);
    } catch (err) {
      this.logger.warn(
        `AI freeform generation failed, using default template: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      // generate() applies the default template with placeholders resolved.
      freeform = await this.copywriter.generate({
        type,
        buyerName: "{{buyerName}}",
        productName: "{{productName}}",
        merchantId: "preview",
        buyerId: "preview",
        storeName: input.storeName,
      });
    }

    // 2) Meta positional template — built from the SAME AI freeform so it
    // reflects the selected campaign + tone (not a fixed default). The freeform
    // keeps named placeholders ({{buyerName}}, {{couponBlock}}, …); we only need
    // at least one recognizable placeholder to convert to positional. If the AI
    // dropped every placeholder, fall back to the platform default so the Meta
    // template still has variables to approve.
    const hasPlaceholder = /\{\{(buyerName|productName|couponBlock|coupon|discount|link|storeName)\}\}/.test(freeform);
    const meta = this.copywriter.buildMetaTemplate({
      type,
      storeName: input.storeName,
      freeformBody: hasPlaceholder ? freeform : undefined,
    });

    const subject = input.channel === "email" ? `Mensagem de ${NAMES[type]}` : undefined;

    return {
      name: NAMES[type],
      body: freeform,
      subject,
      meta,
    };
  }

  private buildFreeformPrompt(type: string, storeName: string, tone: string): string {
    const typeDescriptions: Record<string, string> = {
      follow_up: "A follow-up message after delivery to check if the customer is happy",
      review_request: "A review request asking for feedback on a product",
      nps: "An NPS survey asking customers to rate 0-10 how likely they'd recommend",
      cross_sell: "A cross-sell message suggesting complementary products",
      win_back: "A win-back message for inactive customers with an incentive",
      loyalty: "A loyalty message congratulating on a purchase milestone",
      reorder: "A reorder reminder for consumable products",
    };

    // Map a friendly tone label to concrete style guidance for the LLM.
    const toneGuidance: Record<string, string> = {
      amigavel: "warm, friendly and close, like talking to a friend",
      profissional: "professional, polished and trustworthy",
      descontraido: "casual, light and playful",
      promocional: "energetic and persuasive, emphasizing the benefit/offer",
      luxo: "elegant, refined and premium",
    };
    const style = toneGuidance[tone?.toLowerCase()] ?? tone ?? "warm and engaging";
    const couponHint =
      type === "cross_sell" || type === "win_back" || type === "loyalty" || type === "reorder"
        ? "Coupon area: {{couponBlock}} (place this exactly where a coupon/benefit should appear; leave it verbatim)\n"
        : "";

    return `Generate a post-sale WhatsApp message for the following scenario:

Type: ${type} (${typeDescriptions[type] || ""})
Store: {{storeName}} (use this placeholder)
Buyer: {{buyerName}} (use this placeholder)
Product: {{productName}} (use this placeholder)
${couponHint}Tone/style: ${style}

Rules:
- Write in Portuguese (pt-BR).
- Match the tone/style above; adapt length to it (a promotional message can be richer, a utility one shorter).
- Include a natural call-to-action when it fits the campaign type.
- Never guarantee discounts, free shipping, or request sensitive data.
- Use emojis naturally (a few, not excessive).
- Keep every placeholder EXACTLY as written ({{buyerName}}, {{productName}}, {{storeName}}${couponHint ? ", {{couponBlock}}" : ""}).

Respond with only the message text, no explanations.`;
  }
}
