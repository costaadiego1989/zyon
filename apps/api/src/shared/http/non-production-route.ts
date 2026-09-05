import { SetMetadata } from "@nestjs/common";

export const NON_PRODUCTION_ROUTE = "aacp:non-production-route";

export const NonProductionRoute = () => SetMetadata(NON_PRODUCTION_ROUTE, true);

/** Enables an explicitly authenticated handler inside a legacy controller. */
export const ProductionRoute = () => SetMetadata(NON_PRODUCTION_ROUTE, false);
