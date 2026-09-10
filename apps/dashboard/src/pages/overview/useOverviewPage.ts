import { useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import type { MerchantProfile } from "../../api-client.js";
import type { Period, StoreOverview, TimeseriesResponse } from "./types.js";
import type { DashboardOverview } from "@zyon/shared-types";
import type { FunnelData } from "../../api/endpoints/funnel.js";

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
  funnelData: FunnelData | null;
  storefrontFunnelData: FunnelData | null;
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
  const [funnelData, setFunnelData] = useState<FunnelData | null>(null);
  const [storefrontFunnelData, setStorefrontFunnelData] = useState<FunnelData | null>(null);
  const [previousCheckoutOverview, setPreviousCheckoutOverview] = useState<DashboardOverview | null>(null);
  const [previousStoreOverview, setPreviousStoreOverview] = useState<StoreOverview | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestVersion = useRef(0);

  const plan = (props.me as any).plan ?? "BOTH";
  const showCheckout = plan === "BOTH" || plan === "STORE_ONLY";
  const showStore = plan === "STORE_ONLY" || plan === "BOTH";
  const hasData = !!(checkoutOverview || storeOverview);

  useEffect(() => {
    void fetchAll();
  }, [period]);

  useEffect(() => {
    const interval = setInterval(() => void fetchAll(), 60_000);
    return () => clearInterval(interval);
  }, [period]);

  async function fetchAll() {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const [checkout, checkoutFunnel, store, storefrontFunnel, nextTimeseries] = await Promise.all([
        showCheckout ? api.getDashboardOverview(props.me.id, period) : Promise.resolve(null),
        showCheckout ? api.getCheckoutFunnel(props.me.id, { period }) : Promise.resolve(null),
        showStore ? api.getStoreOverview(props.me.id, period) : Promise.resolve(null),
        showStore ? api.getStorefrontFunnel(props.me.id, { period }) : Promise.resolve(null),
        api.getTimeseries(props.me.id, period),
      ]);
      if (version !== requestVersion.current) return;
      setCheckoutOverview(checkout);
      setFunnelData(checkoutFunnel);
      setStoreOverview(store);
      setStorefrontFunnelData(storefrontFunnel);
      setTimeseries(nextTimeseries);
      // A prior period must be a disjoint, equally sized window. The current
      // API only accepts a rolling period, so suppress trends until it does.
      setPreviousCheckoutOverview(null);
      setPreviousStoreOverview(null);
      setLastUpdated(new Date());
    } catch {
      if (version !== requestVersion.current) return;
      setError("Erro ao carregar dados");
    } finally {
      if (version === requestVersion.current) setLoading(false);
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
    funnelData,
    storefrontFunnelData,
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
