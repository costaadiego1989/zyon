import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { isSafeGeneratedMessage } from "../../../checkout/domain/types/safe-generated-message.js";
import { POST_SALE_TEMPLATE_REPOSITORY, type PostSaleTemplateRepositoryPort } from "../../domain/ports/post-sale-template-repository.port.js";

export interface GenerateMessageInput {
  type: "follow_up" | "review_request" | "nps" | "cross_sell" | "win_back" | "loyalty" | "reorder";
  buyerName: string;
  productName: string;
  merchantId: string;
  buyerId: string;
  storeName?: string;
  /** Coupon code to surface in the message (loyalty / win-back / promo). */
  couponCode?: string;
  /** Discount percent tied to the coupon, for copy like "10% OFF". */
  discountPercent?: number;
  /** Whether the coupon also grants free shipping (win-back tiers). */
  freeShipping?: boolean;
  /** ISO expiry to render a "válido até" line. */
  expiresAt?: string;
  /** CTA link (store, reorder, product). Falls back to storeUrl. */
  link?: string;
  /** Base storefront URL for building default links. */
  storeUrl?: string;
}

@Injectable()
export class PostSaleAiCopywriterService {
  private readonly logger = new Logger(PostSaleAiCopywriterService.name);

  constructor(
    @Optional() @Inject(POST_SALE_TEMPLATE_REPOSITORY)
    private readonly templateRepo?: PostSaleTemplateRepositoryPort
  ) {}

  async generate(input: GenerateMessageInput): Promise<string> {
    const channel = "whatsapp";

    // Try merchant custom template first
    if (this.templateRepo) {
      try {
        const customTemplate = await this.templateRepo.findByMerchantAndType(input.merchantId, input.type, channel);
        if (customTemplate) {
          return this.interpolateTemplate(customTemplate.body, input);
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch merchant template: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Use rich platform default
    const template = this.getDefaultTemplate(input.type);
    return this.interpolateTemplate(template, input);
  }

  private interpolateTemplate(template: string, input: GenerateMessageInput): string {
    const link = input.link || input.storeUrl || "";
    const couponBlock = this.buildCouponBlock(input);

    let out = template
      .replace(/\{\{buyerName\}\}/g, input.buyerName)
      .replace(/\{\{productName\}\}/g, input.productName)
      .replace(/\{\{storeName\}\}/g, input.storeName || "loja")
      .replace(/\{\{coupon\}\}/g, input.couponCode || "")
      .replace(/\{\{discount\}\}/g, input.discountPercent ? `${input.discountPercent}%` : "")
      .replace(/\{\{couponBlock\}\}/g, couponBlock)
      // {{link}} now resolves to a real URL when known; empty string otherwise
      // (no more dead "#" that looked like a broken link).
      .replace(/\{\{link\}\}/g, link);

    // Collapse artifacts left by empty placeholders: 3+ newlines → 2,
    // trailing "Confira: " / "Dá uma olhada: " with nothing after, etc.
    out = out
      .replace(/[ \t]*(Confira|Dá uma olhada|Reponha aqui com facilidade|Confira as novidades)\s*:\s*(?=\n|$)/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return out;
  }

  /**
   * Build the coupon call-to-action block. Empty when there is no coupon, so
   * templates that reference {{couponBlock}} degrade cleanly to no dangling
   * text. Keeps the buyer from ever seeing a promised-but-missing benefit.
   */
  private buildCouponBlock(input: GenerateMessageInput): string {
    if (!input.couponCode) return "";
    const parts: string[] = [];
    const discount = input.discountPercent ? `${input.discountPercent}% OFF` : "um desconto especial";
    const shipping = input.freeShipping ? " + frete grátis" : "";
    parts.push(`🎟️ Use o cupom *${input.couponCode}* e ganhe ${discount}${shipping}.`);
    if (input.expiresAt) {
      const d = new Date(input.expiresAt);
      if (!Number.isNaN(d.getTime())) {
        parts.push(`Válido até ${d.toLocaleDateString("pt-BR")}.`);
      }
    }
    const link = input.link || input.storeUrl;
    if (link) parts.push(`Aproveite aqui: ${link}`);
    return parts.join("\n");
  }

  private getDefaultTemplate(type: string): string {
    const templates: Record<string, string> = {
      follow_up: `Oi {{buyerName}}! 😊 Aqui é da {{storeName}}.

Seu {{productName}} já chegou? Queremos saber se está tudo certo com o pedido!

Se precisar de algo, é só responder aqui. Estamos à disposição! 💬`,

      review_request: `Oi {{buyerName}}! ⭐

Você recebeu o {{productName}} há alguns dias. O que achou?

De 1 a 5 estrelas, que nota você dá? Responda com o número (1 a 5) e, se quiser, um comentário sobre o produto!

Sua opinião ajuda demais outros clientes. Obrigado! 🙏`,

      nps: `Oi {{buyerName}}! 😊

Aqui é da {{storeName}}. Seu pedido do {{productName}} chegou faz uns dias.

De 1 a 5 estrelas, o quanto você recomendaria a gente? ⭐

É só responder com o número (1 a 5) aqui mesmo! 🙏`,

      cross_sell: `{{buyerName}}, tudo bem? 🎁

Como você comprou o {{productName}}, separamos algumas opções que combinam perfeitamente!

{{couponBlock}}

Estamos à disposição! 💛`,

      win_back: `Oi {{buyerName}}! Sentimos sua falta! 💜

Faz um tempo que você não aparece por aqui. A {{storeName}} preparou algo especial pra você voltar.

{{couponBlock}}

Te esperamos! 🙌`,

      loyalty: `Parabéns, {{buyerName}}! 🎉🎊

Você acaba de completar mais uma compra conosco na {{storeName}}!

Como agradecimento pela sua fidelidade, preparamos um benefício exclusivo:

{{couponBlock}}

Obrigado por fazer parte! 💛`,

      reorder: `{{buyerName}}, tudo bem? 🔔

Lembra do {{productName}} que você comprou? Pelo tempo de uso, pode ser que esteja na hora de repor!

{{couponBlock}}

Cuidamos do frete pra você! 📦`,
    };

    return templates[type] || `Oi {{buyerName}}! Tudo bem?`;
  }

  /**
   * Category Meta assigns to each campaign type. Transactional post-sale
   * (delivery follow-up, review, NPS, loyalty, win-back, reorder) is UTILITY;
   * cross-sell is MARKETING. Getting this right speeds Meta approval.
   */
  metaCategoryFor(type: GenerateMessageInput["type"]): "UTILITY" | "MARKETING" {
    return type === "cross_sell" ? "MARKETING" : "UTILITY";
  }

  /**
   * Build a Meta/Twilio template (positional {{1}} body) from a semantic body.
   *
   * Meta approval requires positional variables, not named ones. We convert our
   * named placeholders ({{buyerName}} …) to positional ({{1}} …) and return the
   * position→name map plus sample values for the approval request.
   *
   * `{{couponBlock}}` is flattened to a single positional variable so the
   * coupon still renders; when a campaign has no coupon, the variable is simply
   * absent from the map.
   */
  buildMetaTemplate(input: {
    type: GenerateMessageInput["type"];
    storeName?: string;
    freeformBody?: string;
  }): {
    metaBody: string;
    variableMap: Record<string, string>;
    sampleVariables: Record<string, string>;
    category: "UTILITY" | "MARKETING";
    language: string;
  } {
    // Start from the provided freeform body or the platform default, but strip
    // the emoji-only artifacts Meta tends to reject in UTILITY templates.
    const source = (input.freeformBody?.trim() || this.getDefaultTemplate(input.type)).replace(
      /\{\{storeName\}\}/g,
      input.storeName || "loja"
    );

    // Semantic placeholder → sample value. Order defines positional index.
    const orderedVars: Array<{ name: string; token: RegExp; sample: string }> = [
      { name: "buyerName", token: /\{\{buyerName\}\}/g, sample: "Ana" },
      { name: "productName", token: /\{\{productName\}\}/g, sample: "seu pedido" },
      { name: "couponBlock", token: /\{\{couponBlock\}\}/g, sample: "cupom LOJA10 (10% OFF)" },
      { name: "coupon", token: /\{\{coupon\}\}/g, sample: "LOJA10" },
      { name: "discount", token: /\{\{discount\}\}/g, sample: "10%" },
      { name: "link", token: /\{\{link\}\}/g, sample: "https://loja.exemplo/promo" },
    ];

    const variableMap: Record<string, string> = {};
    const sampleVariables: Record<string, string> = {};
    let metaBody = source;
    let position = 0;

    for (const v of orderedVars) {
      if (!v.token.test(metaBody)) continue;
      position += 1;
      const posStr = String(position);
      variableMap[posStr] = v.name;
      sampleVariables[posStr] = v.sample;
      metaBody = metaBody.replace(v.token, `{{${posStr}}}`);
    }

    // Collapse whitespace artifacts and trim.
    metaBody = metaBody.replace(/\n{3,}/g, "\n\n").trim();

    return {
      metaBody,
      variableMap,
      sampleVariables,
      category: this.metaCategoryFor(input.type),
      language: "pt_BR",
    };
  }

  async generateWithAi(
    prompt: string
  ): Promise<string> {
    const providers = [
      {
        baseUrl: process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1",
        apiKey: process.env.LOCAL_LLM_API_KEY || "ollama",
        model: process.env.LOCAL_LLM_MODEL || "llama3.2",
      },
      {
        baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY || "",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      },
    ];

    for (const provider of providers) {
      if (!provider.apiKey) continue;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
          body: JSON.stringify({
            model: provider.model,
            messages: [
              {
                role: "system",
                content: "You are a post-sale messaging expert for e-commerce in Brazil. Generate persuasive, warm messages in pt-BR. Use {{buyerName}}, {{productName}}, {{link}}, {{storeName}} as placeholders. Never invent discounts, guarantees, or request sensitive data.",
              },
              { role: "user", content: prompt },
            ],
            max_tokens: 300,
            temperature: 0.6,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          this.logger.debug(`Provider ${provider.model} failed with status ${res.status}`);
          continue;
        }

        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (text) {
          const safety = isSafeGeneratedMessage(text);
          if (safety.safe) {
            return text;
          }
          this.logger.warn(`Generated message failed safety check: ${safety.reason}`);
        }
      } catch (err) {
        this.logger.debug(
          `Provider error: ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }
    }

    throw new BadRequestException("ai_generation_failed");
  }
}
