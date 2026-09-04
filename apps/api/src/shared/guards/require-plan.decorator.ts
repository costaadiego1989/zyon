import { SetMetadata } from "@nestjs/common";

export type MerchantPlan = "STORE_ONLY" | "BOTH" | "API";

export const REQUIRE_PLAN_METADATA = "aacp:require_plan";

export const RequirePlan = (...plans: MerchantPlan[]) =>
  SetMetadata(REQUIRE_PLAN_METADATA, plans);
