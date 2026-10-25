import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { EvaluateDiscountInputSchema } from "../schemas.js";

/**
 * Registers `aacp_evaluate_discount` on the given McpServer.
 *
 * Wraps @zyon/rules-engine's evaluateDiscountOffer with sensible defaults
 * (DEFAULT_MERCHANT_RULES baseline, 4% payment fee baked in via engine).
 */
export function registerEvaluateDiscount(server: McpServer): void {
  server.tool(
    "aacp_evaluate_discount",
    "Evaluate whether a discount request respects merchant margin and cap rules. Returns approved/denied with the effective percent and resulting margin.",
    EvaluateDiscountInputSchema.shape,
    async (input) => {
      const cartTotal = input.cartItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );
      const cart: Cart = {
        currency: "BRL",
        total: cartTotal,
        items: input.cartItems.map((i) => ({
          sku: i.sku,
          name: i.sku,
          price: i.price,
          cost: i.cost,
          quantity: i.quantity,
          weightGrams: i.weightGrams
        }))
      };

      // Baseline merchant rules. Tools can pass overrides via input for stricter
      // callers, but defaults keep the tool callable without a full rules fetch.
      const rules: MerchantRules = {
        maxDiscountPercent: input.maxDiscountPercent ?? 10,
        minimumMarginPercent: input.minimumMarginPercent ?? 38,
        allowFreeShipping: true,
        allowShippingDiscount: true,
        allowBonusItem: false,
        allowStackDiscountAndFreeShipping: false,
        freeShippingMinCartValue: 250,
        maxShippingSubsidy: 45,
        maxPartialShippingDiscount: 20,
        offerExpirationMinutes: 15,
        blockedRegions: [],
        brandVoice: "consultative",
        couponBoxEnabled: true,
        autonomousEngineEnabled: true
      };

      const evaluation = evaluateDiscountOffer(
        cart,
        rules,
        input.requestedDiscountPercent,
        input.maxReaisCap
      );

      const marginPercent = evaluation.marginAfterOffer * 100;

      const output = {
        approved: evaluation.approved,
        finalDiscountPercent: evaluation.approved ? evaluation.value : 0,
        marginPercent: Number(marginPercent.toFixed(2)),
        reason: evaluation.reason,
        type: evaluation.type
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
    }
  );
}
