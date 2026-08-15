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
  previousCheckoutOverview: DashboardOverview | null;
  previousStoreOverview: StoreOverview | null;
  plan: string;
  showCheckout: boolean;
  showStore: boolean;
  hasData: boolean;
  refresh: () => Promise<void>;
  lastUpdated: Date | null;
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
  const [previousCheckoutOverview, setPreviousCheckoutOverview] = useState<DashboardOverview | null>(null);
  const [previousStoreOverview, setPreviousStoreOverview] = useState<StoreOverview | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const plan = (props.me as any).plan ?? "BOTH";
  const showCheckout = plan === "CHECKOUT_ONLY" || plan === "BOTH";
  const showStore = plan === "STORE_ONLY" || plan === "BOTH";
  const hasData = !!(checkoutOverview || storeOverview);

  useEffect(() => {
    void fetchAll();
  }, [period]);

  useEffect(() => {
    const interval = setInterval(() => void fetchAll(), 60_000);
    return () => clearInterval(interval);
  }, [period]);

  function getPreviousPeriod(p: Period): Period {
    const map: Record<Period, Period> = {
      today: "today",
      "7d": "7d",
      "30d": "7d",
      "90d": "30d",
    };
    return map[p] ?? "7d";
  }

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

      const prevPeriod = getPreviousPeriod(period);
      if (showCheckout) {
        promises.push(
          api.getDashboardOverview(props.me.id).then(setPreviousCheckoutOverview),
        );
      }
      if (showStore) {
        promises.push(
          api.getStoreOverview(props.me.id, prevPeriod).then(setPreviousStoreOverview),
        );
      }

      await Promise.allSettled(promises);
      setLastUpdated(new Date());
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
    previousCheckoutOverview,
    previousStoreOverview,
    plan,
    showCheckout,
    showStore,
    hasData,
    refresh: fetchAll,
    lastUpdated,
    me: props.me,
  };
}
