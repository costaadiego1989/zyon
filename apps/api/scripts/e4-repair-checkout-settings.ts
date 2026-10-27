import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CheckoutSettingsEntity } from "../src/modules/checkout-settings/domain/entities/checkout-settings.entity.js";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const M = "mrc_marketplace_05";

async function main() {
  const cs = await prisma.checkoutSetting.findFirst({ where: { merchantId: M } });
  console.log("BEFORE widgetBehavior:", JSON.stringify(cs?.widgetBehavior));
  console.log("BEFORE mode:", cs?.mode);

  // Preserve my seeded advanced rules
  const rules = Array.isArray(cs?.advancedRules) ? (cs!.advancedRules as any[]) : [];
  console.log("advancedRules preserved:", rules.length);

  // Rebuild valid defaults from the domain entity, then attach the advanced rules.
  const def = CheckoutSettingsEntity.createDefault({ merchantId: M }).snapshot();

  await prisma.checkoutSetting.update({
    where: { merchantId: M },
    data: {
      mode: def.mode,
      widgetBehavior: def.widgetBehavior as any,
      interventionPolicy: def.interventionPolicy as any,
      triggerRules: def.triggerRules as any,
      suppressionRules: def.suppressionRules as any,
      handoff: def.handoff as any,
      advancedRules: rules as any,
    },
  });
  console.log("REPAIRED with valid defaults + preserved", rules.length, "advanced rule(s)");
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());