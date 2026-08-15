import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import type { MerchantProfile } from "../../api-client.js";
import type { Period, StoreOverview, TimeseriesResponse } from "./types.js";
import type { DashboardOverview } from "@zyon/shared-types";

export interface OverviewPageProps {
  me: MerchantProfile;
}

export interface OverviewPageVM {
  period: Period;
  setPeriod: (p: Period) => void;
  loading: boolean;
  error: string | null;
  checkoutOverview: DashboardOverview | null;
  storeOverview: StoreOverview | null;
  timeseries: TimeseriesResponse | null;
  plan: string;
  showCheckout: boolean;
  showStore: boolean;
  hasData: boolean;
  refresh: () => Promise<void>;
  me: MerchantProfile;
}

export function useOverviewPage(props: OverviewPageProps): OverviewPageVM {
  const api = useApi();

  const [period, setPeriod] = useState<Period>("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutOverview, setCheckoutOverview] = useState<DashboardOverview | null>(null);
  const [storeOverview, setStoreOverview] = useState<StoreOverview | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesResponse | null>(null);

  const plan = (props.me as any).plan ?? "BOTH";
  const showCheckout = plan === "CHECKOUT_ONLY" || plan === "BOTH";
  const showStore = plan === "STORE_ONLY" || plan === "BOTH";
  const hasData = !!(checkoutOverview || storeOverview);

  useEffect(() => {
    void fetchAll();
  }, [period]);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const promises: Promise<unknown>[] = [];
      if (showCheckout) {
        promises.push(
          api.getDashboardOverview(props.me.id).then(setCheckoutOverview),
        );
      }
      if (showStore) {
        promises.push(
          api.getStoreOverview(props.me.id, period).then(setStoreOverview),
        );
      }
      promises.push(
        api.getTimeseries(props.me.id, period).then(setTimeseries),
      );
      await Promise.allSettled(promises);
    } catch {
      setError("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }

  return {
    period,
    setPeriod,
    loading,
    error,
    checkoutOverview,
    storeOverview,
    timeseries,
    plan,
    showCheckout,
    showStore,
    hasData,
    refresh: fetchAll,
    me: props.me,
  };
}
