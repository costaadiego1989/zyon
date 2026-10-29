import type { StoreOverview, StorePeriod, TimeseriesResponse } from "@zyon/shared-types";

export const STORE_OVERVIEW_READ_MODEL = Symbol("STORE_OVERVIEW_READ_MODEL");

export interface StoreOverviewReadModel {
  storeOverview(merchantId: string, period: StorePeriod): Promise<StoreOverview>;
  timeseries(merchantId: string, period: StorePeriod): Promise<TimeseriesResponse>;
}
