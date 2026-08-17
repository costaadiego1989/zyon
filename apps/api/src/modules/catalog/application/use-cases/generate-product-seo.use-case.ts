import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";

export interface GenerateProductSeoInput {
  merchantId: string;
  productId: string;
  tone?: "profissional" | "casual" | "luxo" | "técnico";
}

export interface GenerateProductSeoOutput {
  seoTitle: string;
  metaDescription: string;
  slug: string;
  ogTitle: string;
  ogDescription: string;
  keywords: string[];
}

@Injectable()
export class GenerateProductSeoUseCase {
  private readonly logger = new Logger(GenerateProductSeoUseCase.name);

  constructor(
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
  ) {}

  async execute(input: GenerateProductSeoInput): Promise<GenerateProductSeoOutput> {
    const product = await this.productRepo.findById(input.merchantId, input.productId);
    if (!product) throw new NotFoundException("product_not_found");

    const tone = input.tone ?? "profissional";
    const prompt = this.buildPrompt(product.name, product.description, tone);
    const raw = await this.callLlm(prompt);
    return this.parseAndValidate(raw, product.name);
  }

  private buildPrompt(name: string, description: string | undefined, tone: string): string {
    return `Você é um especialista em SEO para e-commerce brasileiro.
Gere conteúdo SEO otimizado para o produto abaixo.

Produto: ${name}
${description ? `Descrição: ${description}` : ""}
Tom: ${tone}

Regras obrigatórias:
- seoTitle: máximo 60 caracteres, inclua palavra-chave principal
- metaDescription: máximo 160 caracteres, call-to-action sutil
- slug: URL-friendly, lowercase, hifens, sem acentos, sem palavras curtas (de, da, do, para)
- ogTitle: máximo 95 caracteres, otimizado para redes sociais
- ogDescription: máximo 200 caracteres, gere curiosidade
- keywords: array com 5 a 10 palavras-chave relevantes em português

Responda EXCLUSIVAMENTE em JSON válido (sem markdown, sem comentários):
{"seoTitle":"","metaDescription":"","slug":"","ogTitle":"","ogDescription":"","keywords":[]}`;
  }

  private async callLlm(prompt: string): Promise<string> {
    const providers = [
      {
        baseUrl: process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1",
        apiKey: process.env.LOCAL_LLM_API_KEY || "ollama",
        model: process.env.LOCAL_LLM_MODEL || "llama3.2",
      },
      {
        baseUrl: process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "",
        model: process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || "deepseek-chat",
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
              { role: "system", content: "Você é um assistente que responde exclusivamente em JSON válido." },
              { role: "user", content: prompt },
            ],
            max_tokens: 500,
            temperature: 0.6,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        if (!res.ok) continue;

        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (text) return text;
      } catch {
        continue;
      }
    }

    throw new BadRequestException("ai_generation_failed");
  }

  private parseAndValidate(raw: string, productName: string): GenerateProductSeoOutput {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new BadRequestException("ai_invalid_response");

    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new BadRequestException("ai_invalid_json");
    }

    const seoTitle = String(parsed.seoTitle || "").slice(0, 60);
    const metaDescription = String(parsed.metaDescription || "").slice(0, 160);
    const ogTitle = String(parsed.ogTitle || seoTitle).slice(0, 95);
    const ogDescription = String(parsed.ogDescription || metaDescription).slice(0, 200);
    const slug = this.slugify(parsed.slug || productName);
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k: unknown) => typeof k === "string" && k.trim()).slice(0, 10)
      : [];

    if (!seoTitle || !metaDescription) {
      throw new BadRequestException("ai_incomplete_response");
    }

    return { seoTitle, metaDescription, slug, ogTitle, ogDescription, keywords };
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);
  }
}
