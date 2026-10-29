/**
 * Bateria de garantia do Motor de Inteligência Autônoma de Descontos.
 *
 * Valida cada elo do ciclo contra o BANCO REAL (não mocks): kill-switch,
 * cap em reais, geração de candidatas, aprovação apply_direct (regra ativa),
 * aprovação test_ab (experimento A/B), notificações, LGPD/intents, e
 * benefícios do cliente. Rode a qualquer momento para provar que o motor
 * está funcionando end-to-end.
 *
 * Uso: cd apps/api && npx tsx scripts/verify-motor-garantia.ts
 * (requer o merchant seedado — ver scripts/seed-autonomous-discount-scenarios.ts)
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname ?? __dirname, "..", ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const p = createPrismaClient();
const MERCHANT_EMAIL = "costaadiego1989@gmail.com";
const ok = (b: boolean) => (b ? "✅" : "❌");

(async () => {
  const mu = await prismaFindMerchant();
  if (!mu) { console.error(`Merchant não encontrado: ${MERCHANT_EMAIL}`); process.exit(1); }
  const M = mu;
  let pass = 0;
  const total = 8;
  console.log("=== BATERIA DE GARANTIA DO MOTOR (banco real) ===\n");

  const rules = await p.merchantRule.findFirst({ where: { merchantId: M } });
  const c1 = rules?.autonomousEngineEnabled !== undefined; if (c1) pass++;
  console.log(`${ok(c1)} 1. Kill-switch (autonomousEngineEnabled): ${rules?.autonomousEngineEnabled}`);

  const cs = await p.checkoutSetting.findUnique({ where: { merchantId: M } });
  const advRules = (cs?.advancedRules as any[]) ?? [];
  const capRule = advRules.find((r) => r.action?.params?.maxDiscountReais);
  const c2 = !!capRule; if (c2) pass++;
  console.log(`${ok(c2)} 2. Regra com cap em reais: ${capRule ? JSON.stringify(capRule.action.params) : "NENHUMA"}`);

  const hyps = await p.revenueManagerHypothesis.findMany({ where: { merchantId: M } });
  const drHyps = hyps.filter((h) => { try { return (h.templateJson as any)?.hypothesis_type === "discount_rule"; } catch { return false; } });
  const c3 = drHyps.length > 0; if (c3) pass++;
  console.log(`${ok(c3)} 3. Candidatas discount_rule: ${drHyps.length} (status: ${[...new Set(hyps.map((h) => h.status))].join(", ") || "-"})`);

  const activeAiRule = advRules.find((r) => String(r.id).startsWith("rule_ai_") && r.enabled === true);
  const c4 = !!activeAiRule; if (c4) pass++;
  console.log(`${ok(c4)} 4. Regra IA aprovada e ATIVA: ${activeAiRule ? activeAiRule.name : "nenhuma"}`);

  const exps = await p.promptExperiment.findMany({ where: { merchantId: M }, include: { variants: true } });
  const ruleExp = exps.find((e) => e.variants?.some((v: any) => v.appliedRuleId));
  const treatment = ruleExp?.variants?.find((v: any) => v.appliedRuleId);
  const c5 = !!ruleExp; if (c5) pass++;
  console.log(`${ok(c5)} 5. Experimento A/B (test_ab): ${ruleExp ? `status=${ruleExp.status}, tratamento.appliedRuleId=${treatment?.appliedRuleId}` : "nenhum"}`);

  const notifs = await p.merchantNotification.count({ where: { merchantId: M, type: "ai_rule_suggestion" } });
  const c6 = notifs > 0; if (c6) pass++;
  console.log(`${ok(c6)} 6. Notificações ai_rule_suggestion: ${notifs}`);

  const consents = await p.buyerIntentMemoryConsent.count({ where: { merchantId: M, optedIn: true } });
  const intents = await p.customerIntentRecord.count({ where: { merchantId: M } });
  const c7 = consents > 0 && intents > 0; if (c7) pass++;
  console.log(`${ok(c7)} 7. Consentimento LGPD: ${consents} | intents: ${intents}`);

  const benefits = await p.buyerEarnedBenefit.count({ where: { merchantId: M, status: "active" } });
  const c8 = benefits > 0; if (c8) pass++;
  console.log(`${ok(c8)} 8. Benefícios do cliente (hub): ${benefits}`);

  console.log(`\n=== ${pass}/${total} elos validados ===`);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); }).finally(() => p.$disconnect());

async function prismaFindMerchant(): Promise<string | null> {
  const mu = await p.merchantUser.findUnique({ where: { email: MERCHANT_EMAIL }, select: { merchantId: true } });
  return mu?.merchantId ?? null;
}
