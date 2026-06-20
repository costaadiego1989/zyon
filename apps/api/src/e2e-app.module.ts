import { Module } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { CouponsModule } from "./modules/coupons/coupons.module.js";
import { CrossSellModule } from "./modules/cross-sell/cross-sell.module.js";
import { WidgetCrossSellE2eModule } from "./modules/cross-sell/widget-cross-sell-e2e.module.js";
import { TestSeedModule } from "./modules/__test__/test-seed.module.js";

/**
 * Non-production composition root used for e2e / local runs.
 *
 * AppModule stays production-pure (enforced by
 * production-composition-architecture.spec.ts, which forbids CouponsModule /
 * CrossSellModule / TestSeedModule from app.module.ts). This module layers the
 * non-production feature + seed modules on top of AppModule and is selected at
 * boot only when E2E_SEED_ENABLED=true and NODE_ENV !== "production".
 */
@Module({
  imports: [AppModule, CouponsModule, CrossSellModule, WidgetCrossSellE2eModule, TestSeedModule],
})
export class E2eAppModule {}
