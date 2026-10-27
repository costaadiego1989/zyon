import { Injectable, Inject, Logger, BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { GenerateSeoSuggestionsRequest, GenerateSeoSuggestionsResponse } from "@zyon/shared-types";

const SEO_SYSTEM_PROMPT = `You are an expert SEO copywriter for e-commerce stores. Generate compelling, conversion-oriented SEO metadata in Portuguese (Brazil).

You must return ONLY a valid JSON object (no markdown, no backticks) with this exact structure:
{
  "titles": ["title1", "title2", "title3"],
  "descriptions": ["desc1", "desc2", "desc3"],
  "keywords": ["kw1", "kw2", "kw3", "kw4", "kw5"]
}

Rules:
- Each title MUST be ≤70 characters
- Each description MUST be ≤160 characters
- Generate exactly 3 title options and 3 description options
- Generate 5 to 10 keywords
- All content in Portuguese (Brazil)
- Do NOT claim unauthorized discounts, free shipping, delivery guarantees, or stock guarantees
- Focus on brand value, uniqueness, trust signals, and call-to-action
- Include the store category naturally when relevant`;

const TONE_INSTRUCTIONS: Record<string, string> = {
  profissional: "Use a professional, corporate, trust-building tone. Formal language, authority signals.",
  casual: "Use a friendly, approachable, conversational tone. Warm language, relatable.",
  luxo: "Use a premium, exclusive, aspirational tone. Refined language, luxury signals.",
  "técnico": "Use a detailed, specification-focused, precision tone. Technical accuracy, expert signals.",
};

@Injectable()
export class GenerateSeoSuggestionsUseCase {
  private readonly logger = new Logger(GenerateSeoSuggestionsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(
    merchantId: string,
    input: GenerateSeoSuggestionsRequest,
  ): Promise<GenerateSeoSuggestionsResponse> {
    if (!input.prompt || input.prompt.trim().length < 10) {
      throw new BadRequestException("Prompt must be at least 10 characters");
    }
    if (input.prompt.trim().length > 500) {
      throw new BadRequestException("Prompt must be at most 500 characters");
    }

    const validTones = ["profissional", "casual", "luxo", "técnico"];
    if (!validTones.includes(input.tone)) {
      throw new BadRequestException(`Tone must be one of: ${validTones.join(", ")}`);
    }

    const toneInstruction = TONE_INSTRUCTIONS[input.tone] ?? "";
    const categoryContext = input.storeCategory
      ? `Store category: ${input.storeCategory}`
      : "";

    const userPrompt = `${toneInstruction}
${categoryContext}

Business description: ${input.prompt.trim()}

Generate SEO metadata now.`;

    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1";
    const model = process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || "deepseek-chat";

    if (!apiKey) {
      this.logger.warn("No AI API key configured — returning fallback suggestions");
      return this.buildFallback(input.prompt.trim());
    }

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SEO_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 800,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        this.logger.error(`AI API error: ${response.status} — ${errorBody.slice(0, 200)}`);
        throw new Error(`AI API returned ${response.status}`);
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new Error("AI API returned empty content");
      }

      const parsed = JSON.parse(content) as GenerateSeoSuggestionsResponse;
      return this.validateAndNormalize(parsed);
    } catch (error) {
      this.logger.error(`SEO generation failed for merchant ${merchantId}: ${(error as Error).message}`);
      return this.buildFallback(input.prompt.trim());
    }
  }

  private validateAndNormalize(raw: GenerateSeoSuggestionsResponse): GenerateSeoSuggestionsResponse {
    const titles = (raw.titles ?? []).slice(0, 3).map((t) => t.slice(0, 70));
    const descriptions = (raw.descriptions ?? []).slice(0, 3).map((d) => d.slice(0, 160));
    const keywords = (raw.keywords ?? []).slice(0, 10);

    while (titles.length < 3) titles.push("");
    while (descriptions.length < 3) descriptions.push("");

    return {
      titles: titles as [string, string, string],
      descriptions: descriptions as [string, string, string],
      keywords,
    };
  }

  private buildFallback(prompt: string): GenerateSeoSuggestionsResponse {
    const shortPrompt = prompt.slice(0, 50);
    return {
      titles: [
        `${shortPrompt} | Loja Online`.slice(0, 70),
        `Compre ${shortPrompt} com Segurança`.slice(0, 70),
        `${shortPrompt} - Entrega Rápida`.slice(0, 70),
      ],
      descriptions: [
        `Encontre os melhores produtos em ${shortPrompt}. Compre online com segurança e entrega para todo o Brasil.`.slice(0, 160),
        `${shortPrompt} com os melhores preços e condições. Conheça nossa loja e aproveite.`.slice(0, 160),
        `Loja especializada em ${shortPrompt}. Qualidade garantida e atendimento personalizado.`.slice(0, 160),
      ],
      keywords: ["loja online", "comprar", "entrega rápida", "melhor preço", "seguro"],
    };
  }
}
