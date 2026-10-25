import { SetMetadata } from "@nestjs/common";

export const NON_PRODUCTION_ROUTE = "aacp:non-production-route";
export const PRODUCTION_DISABLED_ROUTE = "aacp:production-disabled-route";

export const NonProductionRoute = () => SetMetadata(NON_PRODUCTION_ROUTE, true);

/** Enables an explicitly authenticated handler inside a legacy controller. */
export const ProductionRoute = () => SetMetadata(NON_PRODUCTION_ROUTE, false);

/**
 * Keeps an incomplete or unsafe capability unavailable in production even when
 * ENABLE_LEGACY_ROUTES is temporarily enabled for a separate legacy flow.
 */
export const ProductionDisabledRoute = () => SetMetadata(PRODUCTION_DISABLED_ROUTE, true);
