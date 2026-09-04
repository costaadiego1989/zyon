import { Injectable, Logger, Optional } from "@nestjs/common";
import type {
  HypothesisGenerationRequest,
  HypothesisGenerationResponse,
  HypothesisGeneratorPort,
} from "../domain/ports/hypothesis-generator.port.js";

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
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      this.logger.warn("No OPENAI_API_KEY configured, returning fallback hypothesis");
      return this.generateFallbackHypothesis(request);
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
      return this.generateFallbackHypothesis(request);
    }
  }

  private buildSystemPrompt(constraints: {
    max_discount_percent: number;
    allow_free_shipping: boolean;
    max_running_experiments: number;
  }): string {
    return `You are a conversion optimization expert generating A/B test hypotheses for e-commerce checkouts.

Your task: Analyze checkout metrics and generate a testable hypothesis to improve conversion rate.

Constraints:
- Max discount: ${constraints.max_discount_percent}%
- Free shipping allowed: ${constraints.allow_free_shipping}
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
      "system_prompt": "string (existing behavior, minimal prompt)",
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

    const parsed = JSON.parse(jsonMatch[0]) as HypothesisGenerationResponse;

    // Validate
    if (!parsed.hypothesis_text || !parsed.reasoning || !parsed.template) {
      throw new Error("Invalid response structure");
    }

    // Clamp expected lift
    parsed.expected_lift_percent = Math.min(30, Math.max(0, parsed.expected_lift_percent));

    return parsed;
  }

  private generateFallbackHypothesis(request: HypothesisGenerationRequest): HypothesisGenerationResponse {
    const observation = request.observation;
    const topReason = observation.abandonment.top_abandonment_objection;

    // Fallback strategy: target the top abandonment reason
    let variant_a_prompt = "You are a helpful checkout assistant.";
    let variant_b_prompt = "You are a helpful checkout assistant.";
    let testName = "Control vs Improved";
    let hypothesis_text = "Improve checkout experience";

    if (topReason === "shipping_cost") {
      hypothesis_text = "Emphasize shipping cost transparency and offer alternatives";
      variant_a_prompt =
        "You are a checkout assistant. Answer questions about the purchase. Be concise.";
      variant_b_prompt =
        "You are a checkout assistant. When shipping is mentioned, proactively explain options and offer to calculate exact costs. Be helpful and reassuring.";
      testName = "Shipping Cost Messaging";
    } else if (topReason === "price") {
      hypothesis_text = "Offer strategic discount on higher-cart-value orders";
      variant_a_prompt = "You are a checkout assistant. Answer questions naturally.";
      variant_b_prompt =
        "You are a checkout assistant. If the cart is $100+, mention a 5% loyalty discount option to reduce hesitation.";
      testName = "Price Sensitivity Response";
    } else if (topReason === "payment") {
      hypothesis_text = "Build trust around payment security";
      variant_a_prompt = "You are a checkout assistant. Answer questions briefly.";
      variant_b_prompt =
        "You are a checkout assistant. When payment concerns arise, explain encryption and security measures used.";
      testName = "Payment Security Assurance";
    }

    const expectedLift = observation.abandonment.abandonment_rate > 0.5 ? 8 : 3; // Higher lift if abandonment is high

    return {
      hypothesis_text,
      reasoning: `Current abandonment rate is ${(observation.abandonment.abandonment_rate * 100).toFixed(1)}%. Top reason: ${topReason}. Testing targeted response strategy.`,
      expected_lift_percent: expectedLift,
      template: {
        name: testName,
        description: `Test improved ${topReason} handling in checkout chat`,
        variant_a: {
          name: "Control",
          system_prompt: variant_a_prompt,
          weight: 50,
          is_control: true,
        },
        variant_b: {
          name: "Improved",
          system_prompt: variant_b_prompt,
          weight: 50,
          is_control: false,
        },
      },
    };
  }
}
