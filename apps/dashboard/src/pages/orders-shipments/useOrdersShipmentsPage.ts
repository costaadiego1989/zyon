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
  const [cancelBusyOrderId, setCancelBusyOrderId] = useState<string | null>(null);

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

  // This page derives KPIs from the loaded population, so it must follow every
  // cursor instead of presenting an arbitrary client-side subset as a total.
  const loadAll = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const all: TenantOrder[] = [];
      let cursor: string | undefined = undefined;
      const seenCursors = new Set<string>();
      // Larger server page reduces round-trips; the API caps at its own max.
      const PER_REQUEST = 100;
      do {
        if (cursor) {
          if (seenCursors.has(cursor)) throw new Error("Order pagination returned a repeated cursor.");
          seenCursors.add(cursor);
        }
        const result: CursorPage<TenantOrder> = await api.getOrders(PER_REQUEST, cursor);
        const items = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result as unknown as TenantOrder[] : [];
        all.push(...items);
        cursor = result?.next_cursor ?? undefined;
      } while (cursor);

      setOrders(all);
      setNextCursor(null);
      setHasMore(false);
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
    void loadAll();
  }, [props.me, loadAll]);

  const metrics = useMemo(() => computeOrderMetrics(orders), [orders]);
  const filteredOrders = useMemo(
    () => filterOrders(orders, statusFilter, searchQuery, startDate, endDate),
    [orders, statusFilter, searchQuery, startDate, endDate],
  );
  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

  const exportCsv = useCallback((ordersToExport?: TenantOrder[]) => {
    const data = ordersToExport ?? filteredOrders;
    const header = "id,cliente,email,telefone,endereco,status,total_minor,moeda,metodo_pagamento,provider,data_pagamento,rastreio,data_pedido";
    const rows = data.map((o: TenantOrder) => {
      const customer = o.customer as { full_name?: string; email?: string; phone?: string; address?: { street?: string; number?: string; complement?: string; neighborhood?: string; city?: string; state?: string; zip?: string } } | null;
      const name = customer?.full_name ?? "";
      const email = customer?.email ?? "";
      const phone = customer?.phone ?? "";
      const addr = customer?.address;
      const endereco = addr
        ? [addr.street, addr.number, addr.complement, addr.neighborhood, `${addr.city ?? ""}/${addr.state ?? ""}`, addr.zip].filter(Boolean).join(" - ")
        : "";
      const createdAt = o.completed_at ?? o.cancelled_at ?? "";
      const safeCell = (value: string) => /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
      const esc = (v: string) => `"${safeCell(v).replace(/"/g, '""')}"`;
      return [
        esc(o.id),
        esc(name),
        esc(email),
        esc(phone),
        esc(endereco),
        esc(o.status),
        String(o.total),
        esc(o.currency),
        esc(o.payment_method ?? ""),
        esc(o.payment_provider ?? ""),
        esc(o.paid_at ?? ""),
        esc(o.tracking_code ?? ""),
        esc(createdAt),
      ].join(",");
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
      setMessage("Rastreio salvo. Verifique o envio ao cliente no histórico de comunicações.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, trackingDrafts]);

  const changeOrderStatus = useCallback(async (order: TenantOrder, status: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.updateOrderStatus(order.id, status);
      setOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, status } : item));
      showToast("success", `Pedido #${order.external_order_id?.slice(-6) ?? order.id.slice(-6)} → ${STATUS_LABELS[status] ?? status}`);
      return true;
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao atualizar status");
      return false;
    } finally {
      setBusy(false);
    }
  }, [api]);

  const cancelOrder = useCallback(async (order: TenantOrder, input: { reason: string; notifyCustomer: boolean; restock: boolean }) => {
    const reason = input.reason.trim();
    if (!reason) {
      setMessage("Informe o motivo do cancelamento.");
      return false;
    }
    setCancelBusyOrderId(order.id);
    setMessage(null);
    try {
      await api.cancelOrder(order.id, {
        reason,
        notify_customer: input.notifyCustomer,
        restock: input.restock,
      });
      setOrders((prev) => prev.map((item) => item.id === order.id
        ? { ...item, status: "cancelled", cancellation_reason: reason, cancelled_at: new Date().toISOString() }
        : item));
      showToast("success", `Pedido #${order.external_order_id?.slice(-6) ?? order.id.slice(-6)} cancelado`);
      return true;
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao cancelar pedido");
      return false;
    } finally {
      setCancelBusyOrderId(null);
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
    metrics,
    filteredOrders,
    paginatedOrders,
    PAGE_SIZE,
    load,
    exportCsv,
    saveManualTracking,
    changeOrderStatus,
    cancelBusyOrderId,
    cancelOrder,
    updateTrackingDraft,
    budgetRequests,
    budgetLoading,
    updateBudgetStatus,
  };
}
