import { BadRequestException } from "@nestjs/common";
import { type WhatsAppTemplateType } from "../../../whatsapp-templates/domain/catalog/template-types.js";
import { buildCatalog } from "../../../whatsapp-templates/domain/catalog/template-catalog.js";
import { prepareSalesWhatsApp, salesDefaults, salesTemplateType, validateSalesEdit } from "../../../whatsapp-templates/domain/sales-template-content.js";
import { Injectable, Logger } from "@nestjs/common";
import { PostSaleAiCopywriterService } from "../services/post-sale-ai-copywriter.service.js";

export interface GeneratePostSaleTemplateInput {
  type: WhatsAppTemplateType;
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


@Injectable()
export class GeneratePostSaleTemplateUseCase {
  private readonly logger = new Logger(GeneratePostSaleTemplateUseCase.name);

  constructor(private readonly copywriter: PostSaleAiCopywriterService) {}

  async execute(input: GeneratePostSaleTemplateInput): Promise<GeneratePostSaleTemplateOutput> {
    const type = salesTemplateType(input.type);
    if (input.channel !== "email" && input.channel !== "whatsapp") throw new BadRequestException("invalid_template_channel");
    const defaults = salesDefaults(type);
    let body = defaults[input.channel].body;
    try {
      const generated = await this.copywriter.generateWithAi(this.buildFreeformPrompt(type, input.storeName, input.tone || "profissional"));
      const edit = validateSalesEdit(type, { email: { ...defaults.email, ...(input.channel === "email" ? { body: generated } : {}) },
        whatsapp: { body: input.channel === "whatsapp" ? generated : defaults.whatsapp.body, revision: 1 } });
      body = edit[input.channel].body;
    } catch { this.logger.warn("AI template unavailable or invalid; using the native suggestion"); }
    const prepared = prepareSalesWhatsApp(type, body);
    return { name: buildCatalog()[type].label, body, subject: input.channel === "email" ? defaults.email.subject : undefined,
      meta: { metaBody: prepared.metaBody, variableMap: prepared.variableMap, sampleVariables: prepared.sampleVariables, category: prepared.category as "UTILITY" | "MARKETING", language: "pt_BR" } };
  }

  private buildFreeformPrompt(type: string, storeName: string, tone: string): string {
    const typeDescriptions: Record<string, string> = {
      follow_up: "A follow-up message after delivery to check if the customer is happy",
      review_request: "A review request asking for feedback on a product",
      nps: "An NPS survey asking customers to rate their experience from 1 to 5, matching the current reply flow",
      cross_sell: "A cross-sell message suggesting complementary products",
      win_back: "A win-back message for inactive customers with an incentive",
      loyalty: "A loyalty message congratulating on a purchase milestone",
      reorder: "A reorder reminder for consumable products",
      cart_recovery: "A cart reminder with the mandatory {{link}}; only {{buyerName}}, {{storeName}} and {{link}} are allowed",
      order_confirmation: "Confirmation for the buyer order {{orderId}}",
      order_shipped: "Shipment notification with {{trackingCode}}",
      order_delivered: "Delivery confirmation for {{orderId}}",
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
Allowed variables and scenario reference: ${salesDefaults(type).whatsapp.body}
${couponHint}Tone/style: ${style}

Rules:
- Write in Portuguese (pt-BR).
- Match the tone/style above; adapt length to it (a promotional message can be richer, a utility one shorter).
- Include a natural call-to-action when it fits the campaign type.
- Never guarantee discounts, free shipping, or request sensitive data.
- Use emojis naturally (a few, not excessive).
- Keep named placeholders exactly as written in the scenario reference. Do not add other variables.

Respond with only the message text, no explanations.`;
  }
}
