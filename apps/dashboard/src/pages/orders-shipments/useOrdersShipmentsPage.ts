import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { DashboardHttpError } from "../../api/http/index.js";
import type { CursorPage, MerchantProfile, TenantOrder } from "../../api-client.js";
import { computeOrderMetrics, filterOrders, STATUS_LABELS } from "./utils.js";
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
    () => filterOrders(orders, statusFilter, searchQuery),
    [orders, statusFilter, searchQuery],
  );
  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

  const exportCsv = useCallback(() => {
    const header = "ID,Status,Valor,Moeda,Cliente,Criado em";
    const rows = filteredOrders.map((o: TenantOrder) => {
      const customer = o.customer as { full_name?: unknown; email?: unknown } | null;
      const name = typeof customer?.full_name === "string" ? customer.full_name : "";
      const email = typeof customer?.email === "string" ? customer.email : "";
      const label = name || email || "-";
      const createdAt = o.completed_at ?? o.cancelled_at ?? "";
      return [o.id, o.status, String(o.total), o.currency, label, createdAt].join(",");
    });
    downloadCsv(header, rows, `pedidos-${new Date().toISOString().slice(0, 10)}.csv`);
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
      setMessage(`Status atualizado para "${STATUS_LABELS[status] ?? status}".`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
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
      const res = await fetch(`${(api as any).baseUrl ?? "http://localhost:3009"}/storefront/budget-requests?merchantId=${props.me.id}`);
      if (res.ok) setBudgetRequests(await res.json());
    } catch { /* */ }
    setBudgetLoading(false);
  }, [props.me]);

  useEffect(() => { void loadBudgets(); }, [loadBudgets]);

  const updateBudgetStatus = useCallback(async (id: string, status: "approved" | "rejected") => {
    try {
      await fetch(`${(api as any).baseUrl ?? "http://localhost:3009"}/storefront/budget-requests/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setBudgetRequests((prev) => prev.map((b) => b.id === id ? { ...b, status } : b));
    } catch { /* */ }
  }, []);

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
