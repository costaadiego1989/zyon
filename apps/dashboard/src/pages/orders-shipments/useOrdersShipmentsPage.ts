import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { DashboardHttpError } from "../../api/http/index.js";
import type { CursorPage, MerchantProfile, TenantOrder } from "../../api-client.js";
import { computeOrderMetrics, filterOrders, STATUS_LABELS } from "./utils.js";
import { showToast } from "../../components/Toast.js";
import { downloadCsv } from "../../hooks/useCsvExport.js";

const PAGE_SIZE = 10;
// KPI tiles (Pedidos/Receita/Ticket) and the period tabs filter client-side over
// the loaded set, so the whole order set must be in memory or the totals reflect
// only page 1 (a merchant with 33 orders showed "Pedidos 10 / R$5.124"). Load all
// pages up to this cap so the numbers are truthful; beyond the cap the tiles would
// undercount, which is acceptable for very large merchants (rare) and far better
// than always capping at 10.
const MAX_ORDERS_LOAD = 1000;

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

  // Fetch every order page (up to the cap) so KPI tiles and period filters reflect
  // the full set, not just the first page. Fixes the "Pedidos 10 / R$5.124" undercount.
  const loadAll = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const all: TenantOrder[] = [];
      let cursor: string | undefined = undefined;
      // Larger server page reduces round-trips; the API caps at its own max.
      const PER_REQUEST = 100;
      do {
        const result: CursorPage<TenantOrder> = await api.getOrders(PER_REQUEST, cursor);
        const items = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result as unknown as TenantOrder[] : [];
        all.push(...items);
        cursor = result?.next_cursor ?? undefined;
      } while (cursor && all.length < MAX_ORDERS_LOAD);

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
    const header = "id,cliente,email,telefone,endereco,status,total,moeda,metodo_pagamento,provider,data_pagamento,rastreio,data_pedido";
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
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      return [
        o.id,
        esc(name),
        esc(email),
        phone,
        esc(endereco),
        o.status,
        String(o.total),
        o.currency,
        o.payment_method ?? "",
        o.payment_provider ?? "",
        o.paid_at ?? "",
        o.tracking_code ?? "",
        createdAt,
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
