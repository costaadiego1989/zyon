import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { DashboardHttpError } from "../../api/http/index.js";
import type { CursorPage, MerchantProfile, TenantOrder } from "../../api-client.js";
import { computeOrderMetrics, filterOrders, STATUS_LABELS } from "./utils.js";
import { showToast } from "../../components/Toast.js";
import { downloadCsv } from "../../hooks/useCsvExport.js";

const PAGE_SIZE = 10;

export function useOrdersShipmentsPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [orders, setOrders] = useState<TenantOrder[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "cancelled" | "budgets">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [trackingDrafts, setTrackingDrafts] = useState<Record<string, string>>({});
  const [labelBusyOrderId, setLabelBusyOrderId] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result: CursorPage<TenantOrder> = await api.getOrders(PAGE_SIZE, cursor);
      const items = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result as unknown as TenantOrder[] : [];
      if (cursor) {
        setOrders((prev) => [...prev, ...items]);
      } else {
        setOrders(items);
      }
      setNextCursor(result?.next_cursor ?? null);
      setHasMore(items.length === PAGE_SIZE);
      setHasLoaded(true);
    } catch (e) {
      setMessage(
        e instanceof DashboardHttpError
          ? e.responseBody.slice(0, 160)
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    if (!props.me) {
      setOrders([]);
      setHasLoaded(false);
      return;
    }
    void load();
  }, [props.me, load]);

  const metrics = useMemo(() => computeOrderMetrics(orders), [orders]);
  const filteredOrders = useMemo(
    () => filterOrders(orders, statusFilter, searchQuery, startDate, endDate),
    [orders, statusFilter, searchQuery, startDate, endDate],
  );
  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

  const exportCsv = useCallback(() => {
    const header = "id,customer,status,total,currency,created_at";
    const rows = filteredOrders.map((o: TenantOrder) => {
      const customer = o.customer as { full_name?: unknown; email?: unknown } | null;
      const name = typeof customer?.full_name === "string" ? customer.full_name : "";
      const email = typeof customer?.email === "string" ? customer.email : "";
      const label = name || email || "-";
      const createdAt = o.completed_at ?? o.cancelled_at ?? "";
      return [o.id, label, o.status, String(o.total), o.currency, createdAt].join(",");
    });
    const bom = String.fromCharCode(0xfeff);
    downloadCsv(bom + header, rows, `orders-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [filteredOrders]);

  const saveManualTracking = useCallback(async (order: TenantOrder) => {
    const trackingCode = (trackingDrafts[order.id] ?? "").trim();
    if (!trackingCode) {
      setMessage("Informe o código de rastreio.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.updateOrderTracking(order.id, {
        tracking_code: trackingCode,
        carrier: "manual",
        status: "label_generated",
      });
      setOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, tracking_code: trackingCode } : item));
      setTrackingDrafts((prev) => ({ ...prev, [order.id]: "" }));
      setMessage("Rastreio salvo. Notificação enviada ao cliente via WhatsApp.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, trackingDrafts]);

  const buyLabel = useCallback(async (order: TenantOrder) => {
    const customer = order.customer as { full_name?: string; document?: string; address?: { zip?: string } } | null;
    const toZip = customer?.address?.zip ?? "";
    if (!toZip) {
      setMessage("CEP do cliente não disponível. Cadastre o endereço antes de gerar etiqueta.");
      return;
    }
    const cart = order.cart as { items?: Array<{ quantity?: number }> };
    setLabelBusyOrderId(order.id);
    setMessage(null);
    try {
      const result = await api.purchaseShippingLabel({
        order_id: order.external_order_id,
        service_id: 1,
        from_zip: (order as any).merchant_origin_zip ?? "",
        to_zip: toZip,
        to_name: customer?.full_name ?? "",
        to_document: customer?.document ?? "",
        packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 20, quantity: Math.max(1, cart.items?.[0]?.quantity ?? 1) }],
      }) as { tracking_code?: string };
      if (result.tracking_code) {
        setOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, tracking_code: result.tracking_code ?? item.tracking_code } : item));
      }
      setMessage("Etiqueta gerada e rastreio sincronizado.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLabelBusyOrderId(null);
    }
  }, [api]);

  const changeOrderStatus = useCallback(async (order: TenantOrder, status: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.updateOrderStatus(order.id, status);
      setOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, status } : item));
      showToast("success", `Pedido #${order.external_order_id?.slice(-6) ?? order.id.slice(-6)} → ${STATUS_LABELS[status] ?? status}`);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao atualizar status");
    } finally {
      setBusy(false);
    }
  }, [api]);

  const updateTrackingDraft = useCallback((orderId: string, value: string) => {
    setTrackingDrafts((prev) => ({ ...prev, [orderId]: value }));
  }, []);

  // Budget requests
  const [budgetRequests, setBudgetRequests] = useState<any[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);

  const loadBudgets = useCallback(async () => {
    if (!props.me) return;
    setBudgetLoading(true);
    try {
      const data = await api.getBudgetRequests(props.me.id);
      setBudgetRequests(data);
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    } finally {
      setBudgetLoading(false);
    }
  }, [api, props.me]);

  useEffect(() => { void loadBudgets(); }, [loadBudgets]);

  const updateBudgetStatus = useCallback(async (id: string, status: "approved" | "rejected") => {
    try {
      await api.updateBudgetRequestStatus(id, status);
      setBudgetRequests((prev) => prev.map((b) => b.id === id ? { ...b, status } : b));
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  return {
    orders,
    message,
    busy,
    hasLoaded,
    expandedOrderId,
    setExpandedOrderId,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    hasMore,
    nextCursor,
    page,
    setPage,
    trackingDrafts,
    labelBusyOrderId,
    metrics,
    filteredOrders,
    paginatedOrders,
    PAGE_SIZE,
    load,
    exportCsv,
    saveManualTracking,
    buyLabel,
    changeOrderStatus,
    updateTrackingDraft,
    budgetRequests,
    budgetLoading,
    updateBudgetStatus,
  };
}
