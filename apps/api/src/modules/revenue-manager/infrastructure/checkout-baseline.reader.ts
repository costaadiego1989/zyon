import type { Prisma } from "@prisma/client";
import { InterventionRuleTextBuilder } from "../../checkout/application/services/intervention-rule-text.builder.js";
import { captureCheckoutChatBaseline } from "../../checkout/infrastructure/adapters/checkout-chat-baseline-capture.js";
import { checkoutContractHash } from "../../checkout/domain/services/checkout-chat-baseline.js";
import type { InterventionPolicy } from "../../checkout/domain/ports/checkout-settings.port.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";

/** Reads only configuration. No buyer/session/order data and no default writes.
 * The caller uses repeatable-read or holds these rows while publishing. */
export async function readCheckoutBaseline(tx: Prisma.TransactionClient, merchantId: string) {
  if (process.env.REVENUE_CHECKOUT_CONTRACT_ENABLED !== "true") return undefined;
  const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: { id: true, name: true } });
  const policy = await tx.merchantRule.findUnique({ where: { merchantId } });
  if (!merchant || !policy || !policy.autonomousEngineEnabled) return undefined;
  const settings = await tx.checkoutSetting.findUnique({ where: { merchantId }, select: { advancedRules: true, interventionPolicy: true } });
  if (!settings) return undefined;
  const config = { advancedRules: Array.isArray(settings?.advancedRules) ? settings.advancedRules : null,
    interventionPolicy: (settings?.interventionPolicy as InterventionPolicy | null) ?? null };
  const builder = new InterventionRuleTextBuilder();
  try {
    return captureCheckoutChatBaseline({ merchantId, merchantName: merchant.name,
      rules: { normal: builder.build(config, false) ?? [], paymentFailed: builder.build(config, true) ?? [] },
      settingsHash: checkoutContractHash(config), policyHash: checkoutContractHash(merchantRulesSnapshot(policy)) });
  } catch { return undefined; } // Malformed stored settings cannot define a baseline.
}

export async function lockCheckoutBaselineRows(tx: Prisma.TransactionClient, merchantId: string) {
  // Same order as initial publication. Baselines require an existing setting;
  // its update or deletion must wait for publication to commit.
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id = ${merchantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM checkout_settings WHERE merchant_id = ${merchantId} FOR SHARE`;
}
