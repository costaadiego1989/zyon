import type { DashboardOverview, StorePeriod } from "@zyon/shared-types";

export const DASHBOARD_READ_MODEL = Symbol("DASHBOARD_READ_MODEL");

export type MaybePromise<T> = T | Promise<T>;

export interface DashboardReadModel {
  overview(merchantId: string, period: StorePeriod): MaybePromise<DashboardOverview>;
}
