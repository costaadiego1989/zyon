import { Injectable, Logger } from "@nestjs/common";
import type {
  HypothesisGenerationRequest,
  HypothesisGenerationResponse,
  HypothesisGeneratorPort,
} from "../domain/ports/hypothesis-generator.port.js";
import { validateHypothesisResponse, validateHypothesisSafety } from "../domain/services/hypothesis-validator.service.js";

/**
 * LLMHypothesisGenerator — Calls Fable 5 API to generate revenue hypotheses.
 *
 * Prompt: Given observation + past lessons, generate a testable hypothesis
 * that could improve conversion rate or reduce abandonment.
 *
 * Returns: hypothesis_text, reasoning, expected_lift%, template (control + variant).
 */
@Injectable()
export class LLMHypothesisGenerator implements HypothesisGeneratorPort {
  private readonly logger = new Logger(LLMHypothesisGenerator.name);

  constructor() {}

  async generate(request: HypothesisGenerationRequest): Promise<HypothesisGenerationResponse> {
    if (typeof request.current_prompt !== "string" || !request.current_prompt.trim()) {
      throw new Error("HYPOTHESIS_BASELINE_UNAVAILABLE");
    }
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      this.logger.warn("No OPENAI_API_KEY configured, returning fallback hypothesis");
      return this.validateResponse(this.generateFallbackHypothesis(request), request);
    }

    try {
      const systemPrompt = this.buildSystemPrompt(request.constraints);
      const userPrompt = this.buildUserPrompt(request);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`LLM API error: ${response.status} ${err}`);
      }

      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      const content = data.choices[0]?.message.content;

      if (!content) {
        throw new Error("Empty response from LLM");
      }

      return this.parseHypothesisResponse(content, request);
    } catch (err) {
      this.logger.warn(`Failed to generate hypothesis via LLM: ${err instanceof Error ? err.message : String(err)}`);
      return this.validateResponse(this.generateFallbackHypothesis(request), request);
    }
  }

  private buildSystemPrompt(constraints: HypothesisGenerationRequest["constraints"]): string {
    return `You are a conversion optimization expert generating A/B test hypotheses for e-commerce checkouts.

Your task: Analyze checkout metrics and generate a testable hypothesis to improve conversion rate.

Constraints:
- Max discount: ${constraints.max_discount_percent}%
- Free shipping allowed: ${constraints.allow_free_shipping}
- Full merchant policy: ${JSON.stringify(constraints.merchant_rules)}
- These limits are not authorization to offer a benefit. Commercial proposals require merchant approval and runtime rules-engine authorization.
- Preserve variant_a.system_prompt exactly as the supplied CURRENT BASELINE; never invent control behavior.
- Never invent a discount, shipping benefit, security property, delivery deadline or urgency.
- Focus on checkout experience (not storefront)

Output MUST be valid JSON in this format:
{
  "hypothesis_text": "string (1-2 sentences describing the test idea)",
  "reasoning": "string (why this should work based on the metrics)",
  "expected_lift_percent": number (0-30, your best guess),
  "template": {
    "name": "string (descriptive test name)",
    "description": "string (what's being tested)",
    "variant_a": {
      "name": "Control",
      "system_prompt": "string (exact CURRENT BASELINE supplied in the request)",
      "weight": 50,
      "is_control": true
    },
    "variant_b": {
      "name": "string (variant name)",
      "system_prompt": "string (modified behavior to test)",
      "weight": 50,
      "is_control": false
    }
  }
}`;
  }

  private buildUserPrompt(request: HypothesisGenerationRequest): string {
    const observation = request.observation;

    let prompt = `Generate hypothesis for merchant ${request.merchant_id}.\n\n`;
    prompt += `CURRENT BASELINE (copy exactly for control):\n${JSON.stringify(request.current_prompt)}\n\n`;
    prompt += `CURRENT METRICS (24h window):\n`;
    prompt += `- Conversion rate: ${(observation.funnel.conversion_rate * 100).toFixed(1)}%\n`;
    prompt += `- Abandonment rate: ${(observation.abandonment.abandonment_rate * 100).toFixed(1)}%\n`;
    prompt += `- Top abandonment reason: ${observation.abandonment.top_abandonment_objection}\n`;
    prompt += `- Cross-sell acceptance: ${(observation.cross_sell.acceptance_rate * 100).toFixed(1)}%\n`;
    prompt += `- Sessions: ${observation.funnel.total_sessions}\n`;
    prompt += `- Completed orders: ${observation.funnel.completed_order}\n`;

    if (observation.current_experiment) {
      prompt += `\n CURRENT RUNNING EXPERIMENT:\n`;
      prompt += `- Control CR: ${(observation.current_experiment.control_conversion_rate * 100).toFixed(1)}%\n`;
      prompt += `- Challenger CR: ${(observation.current_experiment.challenger_conversion_rate * 100).toFixed(1)}%\n`;
      prompt += `- Sessions/variant: ${observation.current_experiment.sessions_per_variant}\n`;
    }

    if (request.past_lessons.length > 0) {
      prompt += `\n PAST LEARNINGS:\n`;
      request.past_lessons.slice(0, 3).forEach((lesson: typeof request.past_lessons[0], i: number) => {
        prompt += `${i + 1}. ${lesson.hypothesis_text} → Lift: ${lesson.conversion_lift_percent.toFixed(1)}% (${lesson.actual_winner})\n`;
      });
    }

    prompt += `\nGenerate a NEW hypothesis that targets the top abandonment reason and fits within constraints.`;

    return prompt;
  }

  private parseHypothesisResponse(
    content: string,
    request: HypothesisGenerationRequest,
  ): HypothesisGenerationResponse {
    // Extract JSON from response (may contain markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    return this.validateResponse(JSON.parse(jsonMatch[0]), request);
  }

  private validateResponse(response: unknown, request: HypothesisGenerationRequest): HypothesisGenerationResponse {
    validateHypothesisResponse(response);
    if (!response.template.variant_a.is_control || response.template.variant_b.is_control) {
      throw new Error("HYPOTHESIS_INVALID_JSON: variant_a must preserve the current control");
    }
    response.template.variant_a.system_prompt = request.current_prompt;
    validateHypothesisSafety(response, request.constraints, request.current_prompt);
    return response;
  }

  private generateFallbackHypothesis(request: HypothesisGenerationRequest): HypothesisGenerationResponse {
    const observation = request.observation;
    const topReason = observation.abandonment.top_abandonment_objection;

    // Fallback strategy: target the top abandonment reason
    let assistance = "Ask whether the buyer needs help with the current checkout step. Use only verified checkout information.";
    let testName = "Contextual Checkout Help";
    let hypothesis_text = "Test a contextual offer of help at the current checkout step";

    if (topReason === "shipping_cost") {
      hypothesis_text = "Emphasize shipping cost transparency and offer alternatives";
      assistance = "Ask what is unclear about delivery and explain only shipping options and costs returned by the current checkout quote.";
      testName = "Shipping Cost Messaging";
    } else if (topReason === "price") {
      hypothesis_text = "Clarify the current cart total and ask which cost needs explanation";
      assistance = "When the buyer asks about price, explain the current cart total using verified line items and ask which cost needs clarification.";
      testName = "Price Sensitivity Response";
    } else if (topReason === "payment") {
      hypothesis_text = "Offer contextual help with available payment methods";
      assistance = "Ask what help the buyer needs with payment and describe only the payment methods shown in the current checkout.";
      testName = "Payment Method Help";
    }

    return {
      hypothesis_text,
      reasoning: `Deterministic help-only fallback. Observed top reason: ${topReason}. No measured or predicted lift is available; zero is a non-estimate placeholder requiring review.`,
      expected_lift_percent: 0,
      template: {
        name: testName,
        description: `Test improved ${topReason} handling in checkout chat`,
        variant_a: {
          name: "Control",
          system_prompt: request.current_prompt,
          weight: 50,
          is_control: true,
        },
        variant_b: {
          name: "Improved",
          system_prompt: `${request.current_prompt}\n\n${assistance}`,
          weight: 50,
          is_control: false,
        },
      },
    };
  }
}
