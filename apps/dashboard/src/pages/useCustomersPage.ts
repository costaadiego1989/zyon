import { useCallback, useEffect, useRef, useState } from "react";
import type { CursorPage, MerchantProfile, TenantCustomer } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { DashboardHttpError } from "../api/http/index.js";
import type { CustomerMetricsResponse } from "../api/endpoints/customer.js";
import { reportError } from "../lib/observability/error-reporter.js";
import { toCustomerRows, type CustomerRow } from "./customers-page.js";

export interface CustomersPageViewModel {
  me: MerchantProfile | null;
  rows: CustomerRow[];
  loading: boolean;
  loadingMore: boolean;
  busy: boolean;
  message: string | null;
  searchTerm: string;
  nextCursor: string | null;
  hasMore: boolean;
  sortCol: "name" | "email" | "lastSeen";
  sortDir: "asc" | "desc";
  dateFilter: "all" | "7d" | "30d";
  page: number;
  pageSize: number;
  selectedCustomerId: string | null;
  customerDetail: unknown | null;
  loadingDetail: boolean;
  detailError: string | null;
  reload: () => Promise<void>;
  retryDetail: () => void;
  metrics: CustomerKpis | null;
  metricsError: string | null;
  setSearchTerm: (v: string) => void;
  setSortCol: (col: "name" | "email" | "lastSeen") => void;
  setSortDir: (dir: "asc" | "desc") => void;
  toggleSort: (col: "name" | "email" | "lastSeen") => void;
  setDateFilter: (f: "all" | "7d" | "30d") => void;
  setPage: (p: number) => void;
  loadMore: () => Promise<void>;
  openCustomerDetail: (customerId: string) => void;
  closeCustomerDetail: () => void;
  setMessage: (m: string | null) => void;
  apiBaseUrl: string;
}

export type CustomerKpis = {
  totalCustomers: number;
  newCustomersLast7Days: number;
  repeatRateLast7Days: number;
};

const PAGE_SIZE = 10;
const CUSTOMER_METRICS_START = "1970-01-01";

export function customerMetricPeriods(now = new Date()): {
  allTime: { dateFrom: string; dateTo: string };
  last7Days: { dateFrom: string; dateTo: string };
} {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 6);
  return {
    allTime: { dateFrom: CUSTOMER_METRICS_START, dateTo: toIsoDate(end) },
    last7Days: { dateFrom: toIsoDate(start), dateTo: toIsoDate(end) },
  };
}

export function toCustomerKpis(
  allTime: CustomerMetricsResponse,
  last7Days: CustomerMetricsResponse,
): CustomerKpis {
  return {
    totalCustomers: allTime.total_customers,
    newCustomersLast7Days: last7Days.new_customers,
    repeatRateLast7Days: last7Days.repeat_rate,
  };
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function errorMessage(e: unknown): string {
  if (e instanceof DashboardHttpError) return e.responseBody.slice(0, 160);
  if (e instanceof Error) return e.message;
  return String(e);
}

export function useCustomersPage(props: {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}): CustomersPageViewModel {
  const api = useApi();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [sortCol, setSortCol] = useState<"name" | "email" | "lastSeen">("lastSeen");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dateFilter, setDateFilter] = useState<"all" | "7d" | "30d">("all");
  const [page, setPage] = useState(1);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<unknown | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [metrics, setMetrics] = useState<CustomerKpis | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const moreRequest = useRef(false);

  const load = useCallback(async () => {
    if (!props.me) return;
    setBusy(true);
    setLoading(true);
    setMessage(null);
    setRows([]);
    setNextCursor(null);
    setHasMore(false);
    setMetrics(null);
    setMetricsError(null);
    setPage(1);
    try {
      const page: CursorPage<TenantCustomer> = await api.getCustomersPage(PAGE_SIZE);
      setRows(toCustomerRows(page.data));
      setNextCursor(page.next_cursor);
      setHasMore(page.has_more);
      try {
        const periods = customerMetricPeriods();
        const [allTime, last7Days] = await Promise.all([
          api.getCustomerMetrics(periods.allTime),
          api.getCustomerMetrics(periods.last7Days),
        ]);
        setMetrics(toCustomerKpis(allTime, last7Days));
      } catch (e) {
        reportError({ source: "customers.metrics", error: e, severity: "warning" });
        setMetricsError("Não foi possível carregar os indicadores. A lista de clientes continua disponível.");
      }
    } catch (e) {
      reportError({ source: "customers.load", error: e, severity: "warning" });
      setMessage("Não foi possível carregar os clientes. Tente novamente.");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [props.me, api]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || moreRequest.current) return;
    moreRequest.current = true;
    setMessage(null);
    setLoadingMore(true);
    setBusy(true);
    try {
      const page: CursorPage<TenantCustomer> = await api.getCustomersPage(PAGE_SIZE, nextCursor);
      setRows((prev) => [...prev, ...toCustomerRows(page.data).filter((row) => !prev.some((existing) => existing.globalUserId === row.globalUserId))]);
      setNextCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (e) {
      reportError({ source: "customers.loadMore", error: e, severity: "warning" });
      setMessage("Não foi possível carregar mais clientes. Os registros já carregados continuam disponíveis.");
    } finally {
      setLoadingMore(false);
      moreRequest.current = false;
      setBusy(false);
    }
  }, [nextCursor, loadingMore, api]);

  const loadCustomerDetail = useCallback(async (customerId: string) => {
    const request = ++detailRequest.current;
    setLoadingDetail(true);
    setCustomerDetail(null);
    setDetailError(null);
    try {
      const detail = await api.getCustomerDetail(customerId);
      if (request === detailRequest.current) setCustomerDetail(detail);
    } catch (e) {
      reportError({ source: "customers.loadDetail", error: e, severity: "warning" });
      if (request === detailRequest.current) setDetailError("Não foi possível carregar o histórico deste cliente. Tente novamente.");
    } finally {
      if (request === detailRequest.current) setLoadingDetail(false);
    }
  }, [api]);

  useEffect(() => {
    if (!props.me) {
      setRows([]);
      return;
    }
    void load();
  }, [props.me, load]);

  function openCustomerDetail(customerId: string) {
    setSelectedCustomerId(customerId);
    void loadCustomerDetail(customerId);
  }

  function closeCustomerDetail() {
    detailRequest.current += 1;
    setSelectedCustomerId(null);
    setCustomerDetail(null);
  }

  function toggleSort(col: "name" | "email" | "lastSeen") {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  return {
    me: props.me,
    rows,
    loading,
    loadingMore,
    busy,
    message,
    searchTerm,
    nextCursor,
    hasMore,
    sortCol,
    sortDir,
    dateFilter,
    page,
    pageSize: PAGE_SIZE,
    selectedCustomerId,
    customerDetail,
    loadingDetail,
    detailError,
    reload: load,
    retryDetail: () => { if (selectedCustomerId) void loadCustomerDetail(selectedCustomerId); },
    metrics,
    metricsError,
    setSearchTerm,
    setSortCol,
    setSortDir,
    toggleSort,
    setDateFilter,
    setPage,
    loadMore,
    openCustomerDetail,
    closeCustomerDetail,
    setMessage,
    apiBaseUrl: props.apiBaseUrl,
  };
}
