import { z } from "zod";

export const SHOPPING_SEARCH_PLAN_UNCONFIRMED = "🔎 Não consegui confirmar uma busca válida para esses critérios. Ainda não verifiquei quais produtos atendem. Podemos reformular a consulta?";

const cents = z.number().int().nonnegative().max(1_000_000_000);
const attribute = z.strictObject({
  name: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(200),
  operator: z.enum(["equals", "not_equals"]),
  priority: z.enum(["required", "preferred"]),
});

/** A model proposes criteria; only canonical reads decide whether they match.
 * No merchant, buyer, cart, price override or executable query is accepted here. */
export const shoppingSearchPlanSchema = z.strictObject({
  version: z.literal(1),
  query: z.string().trim().min(1).max(500),
  recovery: z.strictObject({
    familyQuery: z.string().trim().min(1).max(500),
    optionalQueryTerms: z.array(z.string().trim().min(1).max(120)).max(4),
  }).describe("Read-only recovery after a complete zero-result exact search. Propose recovery for an optional model/name or positive preferences when a grounded product family remains. familyQuery retains query, removing only literal optionalQueryTerms when present; if an optional name is separate from query it must occur literally in the current user request and the backend will add it only to narrow the exact read. Never remove an exclusive model/brand, compatibility or exclusion. Use optionalQueryTerms=[] when only relaxing preferred positive attributes. Keep all mandatory attributes and budgets. Return null only when recovery has no grounded family or the buyer requires the exclusive name/model/brand.").optional(),
  minPriceCents: cents.optional(),
  maxPriceCents: cents.optional(),
  minRating: z.number().min(1).max(5).optional(),
  attributes: z.array(attribute).max(12).default([]),
  sortBy: z.enum(["price_asc", "price_desc", "rating", "newest"]).optional(),
  delivery: z.strictObject({
    freeOnly: z.boolean().optional(),
    maxPriceCents: cents.optional(),
    maxBusinessDays: z.number().int().positive().max(365).optional(),
    zipCode: z.string().regex(/^\d{8}$/).optional(),
  }).optional(),
  unsupportedCriteria: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
}).superRefine((plan, ctx) => {
  if (plan.minPriceCents !== undefined && plan.maxPriceCents !== undefined && plan.minPriceCents > plan.maxPriceCents)
    ctx.addIssue({ code: "custom", path: ["maxPriceCents"], message: "price_range_inverted" });
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const required = plan.attributes.filter(item => item.priority === "required");
  for (const item of required) {
    const siblings = required.filter(other => normalize(other.name) === normalize(item.name));
    if (item.operator === "equals" && siblings.some(other => other.operator === "equals"
      && normalize(other.value) !== normalize(item.value)))
      ctx.addIssue({ code: "custom", path: ["attributes"], message: "attribute_conditions_conflict" });
    if (siblings.some(other => other.operator !== item.operator && normalize(other.value) === normalize(item.value)))
      ctx.addIssue({ code: "custom", path: ["attributes"], message: "attribute_conditions_conflict" });
  }
});

export type ShoppingSearchPlan = z.infer<typeof shoppingSearchPlanSchema>;

export const shoppingSearchEvidenceSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(["verified", "needs_information", "unsupported"]),
  appliedPlan: shoppingSearchPlanSchema,
  message: z.string().min(1).max(8000),
  unconfirmedPreferences: z.array(z.string().max(300)).max(12),
  matchType: z.enum(["exact", "similar", "no_match", "incomplete"]).optional(),
  differences: z.array(z.strictObject({ productId: z.string().min(1).max(191),
    details: z.array(z.string().max(400)).max(13) })).max(3).optional(),
});
export type ShoppingSearchEvidence = z.infer<typeof shoppingSearchEvidenceSchema>;
