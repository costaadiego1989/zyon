import { createPrismaClient } from "../shared/persistence/prisma-client.js";
const p = createPrismaClient();

// Find TechStore merchant
const merchant = await p.merchant.findFirst({ where: { name: "TechStore Brasil" } });
if (!merchant) { console.log("Not found"); await p.$disconnect(); process.exit(1); }

console.log("Merchant:", merchant.id);

// Delete onboarding state to force wizard to reappear
const deleted = await p.merchantOnboardingState.deleteMany({ where: { merchantId: merchant.id } });
console.log("Deleted onboarding states:", deleted.count);

// Also reset theme to minimal (simulate fresh state)
await p.merchant.update({
  where: { id: merchant.id },
  data: { theme: { accentColor: "#0F766E", fontFamily: "Manrope, sans-serif", textColor: "#F7FAF7", backgroundColor: "#0A0F0A" } },
});
console.log("Reset theme to minimal defaults");

await p.$disconnect();
