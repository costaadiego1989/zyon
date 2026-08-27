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
    return template
      .replace(/\{\{buyerName\}\}/g, input.buyerName)
      .replace(/\{\{productName\}\}/g, input.productName)
      .replace(/\{\{storeName\}\}/g, input.storeName || "loja")
      .replace(/\{\{link\}\}/g, "#");
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

Dá uma olhada: {{link}}

Tem desconto especial pra quem já é cliente! 💛`,

      win_back: `Oi {{buyerName}}! Sentimos sua falta! 💜

Faz um tempo que você não aparece por aqui. A {{storeName}} preparou algo especial pra você voltar.

Confira as novidades: {{link}}

Te esperamos! 🙌`,

      loyalty: `Parabéns, {{buyerName}}! 🎉🎊

Você acaba de completar mais uma compra conosco na {{storeName}}!

Como agradecimento pela sua fidelidade, preparamos um benefício exclusivo. Confira: {{link}}

Obrigado por fazer parte! 💛`,

      reorder: `{{buyerName}}, tudo bem? 🔔

Lembra do {{productName}} que você comprou? Pelo tempo de uso, pode ser que esteja na hora de repor!

Reponha aqui com facilidade: {{link}}

Cuidamos do frete pra você! 📦`,
    };

    return templates[type] || `Oi {{buyerName}}! Tudo bem?`;
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
