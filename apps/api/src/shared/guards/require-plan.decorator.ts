import { SetMetadata } from "@nestjs/common";

export type MerchantPlan = "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH";

export const REQUIRE_PLAN_METADATA = "aacp:require_plan";

export const RequirePlan = (...plans: MerchantPlan[]) =>
  SetMetadata(REQUIRE_PLAN_METADATA, plans);
