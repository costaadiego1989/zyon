import { z } from "zod";
import type { MerchantRules } from "../../domain/merchant.types.js";
import type { MerchantRulesRepository } from "../../domain/ports/merchant-rules.repository.port.js";

const tenant = z.string().min(1).max(191).refine(value => value.trim().length > 0
  && !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const policy = z.object({
  maxDiscountPercent: z.number().finite().min(0).max(100),
  minimumMarginPercent: z.number().finite().min(0).max(100),
  merchantId: tenant.optional(),
}).passthrough();

/** No provisioning/defaults here. Legacy adapters explicitly own their getRules.
 * Missing/invalid authority is unavailable; failed IO remains a failed read. */
export async function readExistingMerchantRules(
  repository: Pick<MerchantRulesRepository, "getRules" | "getExistingRules">,
  merchantId: string,
): Promise<MerchantRules | undefined> {
  if (!tenant.safeParse(merchantId).success) return undefined;
  const existingRead = repository.getExistingRules;
  const read: ((merchantId: string) => unknown) | undefined = existingRead === undefined ? repository.getRules : existingRead;
  if (typeof read !== "function") return undefined;
  const existing: unknown = await read.call(repository, merchantId);
  const parsed = policy.safeParse(existing);
  if (!parsed.success || (parsed.data.merchantId !== undefined && parsed.data.merchantId !== merchantId)) return undefined;
  // Preserve legitimate optional policy data without mutating/shared aliases.
  return structuredClone(parsed.data) as unknown as MerchantRules;
}

