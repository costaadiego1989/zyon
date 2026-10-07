/** Local fixtures only. Never reads authentication or production data. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createDashboardApi } from "../../src/api-client.js";
import { ApiContext } from "../../src/hooks/useApi.js";
import { OverviewPage } from "../../src/pages/overview/OverviewPage.js";
import { FinancePage } from "../../src/pages/finance/FinancePage.js";
import { OrdersShipmentsPage } from "../../src/pages/orders-shipments-page.js";
import { AuditLogPage } from "../../src/pages/audit-log-page.js";
import { ExperimentsPage } from "../../src/pages/experiments/ExperimentsPage.js";
import "../../src/styles.css";
import "../../src/components/dashboard-ui.css";
import "../../src/components/tab-bar.css";

const state = { failOverview: false, calls: [] as Array<{ method: string; path: string; query: string }>, unknown: [] as string[], archives: [] as string[] };
(window as any).metricsFixture = state;
const base = location.origin + "/__metrics-fixtures";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const generated = new Date().toISOString();
const me = { id: "local-fixture", name: "Loja QA local", plan: "BOTH", role: "owner" } as any;
const variants = [{ id: "control", name: "Control", is_control: true, weight: 50 }, { id: "challenger", name: "Challenger", is_control: false, weight: 50 }];
const metrics = [{ experiment_id: "completed", variant_id: "control", total_visitors: 294, conversions: 1, conversion_rate: .34, revenue: 29.9 }, { experiment_id: "completed", variant_id: "challenger", total_visitors: 259, conversions: 0, conversion_rate: 0, revenue: 0 }];
const experiments = [{ id: "completed", name: "QA resultado com 553 sessões", status: "completed", variants, created_at: generated, started_at: generated, control_variant_id: "control", metrics }, { id: "draft", name: "QA rascunho sem início", status: "draft", variants, created_at: generated, started_at: null, completed_at: null }];
const order = (id: string, productType: string) => ({ id, external_order_id: id, status: "approved", total: 2990, currency: "BRL", completed_at: generated, paid_at: generated, payment_method: "card", tracking_code: null,
  customer: { full_name: "Cliente fictício", email: "qa@example.invalid" },
  fulfillment: { stage: "not_started", version: 1, units: [{ id: "unit-" + id, productType, name: "Produto " + productType, quantity: 1, status: "pending", allowedActions: [], lines: [] }] },
});
const orders = [order("QA-PHYSICAL", "physical"), order("QA-DIGITAL", "digital"), order("QA-FOOD", "food")];
const events = [
  { action: "http.post", path: "/v1/api-keys" }, { action: "http.post", path: "/v1/dashboard/experiments" },
  { action: "http.put", path: "/v1/merchant/settings" }, { action: "http.post", path: "/v1/shipping/quote" },
  { action: "http.delete", path: "/v1/api-keys/:id" },
].map((row, index) => ({ id: String(index), occurred_at: generated, action: row.action, actor_type: "human", actor_id: "QA", resource_type: "fixture", outcome: "success", metadata: { path: row.path } }));

window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (!url.pathname.startsWith("/__metrics-fixtures/")) throw new Error("Fixture forbids external fetch: " + url.pathname);
  const path = url.pathname.slice("/__metrics-fixtures/v1".length);
  const method = init?.method ?? "GET";
  state.calls.push({ method, path, query: url.search });
  let data: any;
  let status = 200;
  if (path.includes("store-overview")) {
    if (state.failOverview) { data = { code: "fixture_refresh_failure" }; status = 503; }
    else data = { revenue: 29.9, orders_count: 1, average_ticket: 29.9, products_sold: 1, new_customers: 1, abandonment_rate: .9, orders_by_status: { approved: 1 }, top_products: [{ name: "Produto QA com nome muito longo para conferir truncamento e largura mínima em celulares", quantity: 1, revenue: 29.9 }], recent_orders: [{ id: "order", buyer_name: "Unknown", total: 29.9, created_at: generated }] };
  } else if (path.includes("timeseries")) {
    const point = { date: today, value: 29.9 };
    data = { revenue_daily: [point], conversion_daily: [{ ...point, value: .1538 }], orders_daily: [{ ...point, value: 1 }], sessions_daily: [{ ...point, value: 17 }] };
  } else if (path.includes("funnel")) data = { steps: [], total_sessions: 17 };
  else if (path.includes("dashboard/overview")) data = { conversations_started: 17, orders_completed: 1, conversion_rate_with_agent: .1538, average_discount: 0, recent_sessions: [] };
  else if (path === "/billing/subscription") data = { plan: "scale", features: {} };
  else if (path === "/dashboard/finance/payouts") data = { items: [], scope_note: "Fixture sem repasses" };
  else if (path.startsWith("/dashboard/finance/")) {
    const period = { from: url.searchParams.get("from"), to: url.searchParams.get("to"), time_zone: "America/Sao_Paulo" };
    if (path.endsWith("summary")) data = { period, generated_at: generated, currency: "BRL", metrics: { completed_orders_gross_brl: 29.9, completed_orders: 1, average_completed_order_value_brl: 29.9, refunds_confirmed_brl: 0 }, series: [{ date: today, completed_orders_gross_brl: 29.9, refunds_brl: 0 }], payment_methods: [{ method: "Cartão", completed_orders_gross_brl: 29.9, orders: 1 }, { method: "Não informado", completed_orders_gross_brl: 1, orders: 1 }], scope_note: "Dados fictícios sem saldo ou repasse" };
    else if (path.endsWith("transactions")) {
      const missing = url.searchParams.get("method") === "Não informado";
      data = { period, page: 1, limit: 25, total: 1, items: [{ id: "tx", kind: "sale", occurred_at: generated, amount_brl: missing ? 1 : 29.9, currency: "BRL", order_reference: missing ? "QA-MISSING" : "QA-CARD", payment_method: missing ? null : "card", status: "approved", payment_intent_id: null }] };
    }
  } else if (path === "/orders") data = { data: orders, next_cursor: null };
  else if (path === "/storefront/budget-requests") data = { data: [], next_cursor: null };
  else if (path === "/audit-events") data = { data: events, next_cursor: null, has_more: false };
  else if (path.endsWith("/rules")) data = { autonomousEngineEnabled: false };
  else if (path === "/dashboard/experiments") data = { data: experiments };
  else if (path.endsWith("/results")) data = { experiment_id: path.split("/")[3], variant_results: metrics.map(row => ({ variant_id: row.variant_id, sessions: row.total_visitors, conversions: row.conversions, conversion_rate: row.conversion_rate, avg_order_value: row.conversions ? row.revenue / row.conversions : 0, revenue: row.revenue })), total_sessions: 553 };
  else if (path.endsWith("/archive") && method === "POST") {
    const id = path.split("/")[3]; state.archives.push(id);
    data = { ...experiments.find(row => row.id === id), status: "archived" };
  }
  if (data === undefined) { state.unknown.push(path); data = { code: "fixture_missing" }; status = 404; }
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
};
const api = createDashboardApi({ baseUrl: base });
function Fixture() {
  const [page, setPage] = useState("overview");
  return <ApiContext.Provider value={api}><nav aria-label="Páginas QA local" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 12 }}>{["overview", "finance", "orders", "activity", "experiments"].map(id => <button key={id} onClick={() => setPage(id)}>Abrir {id}</button>)}</nav><main className="console-content" style={{ padding: 10, width: "100%", minWidth: 0 }}>
    {page === "overview" && <OverviewPage apiBaseUrl={base} defaultMerchantId={me.id} me={me} />}
    {page === "finance" && <FinancePage apiBaseUrl={base} me={me} />}
    {page === "orders" && <OrdersShipmentsPage apiBaseUrl={base} me={me} />}
    {page === "activity" && <AuditLogPage apiBaseUrl={base} me={me} />}
    {page === "experiments" && <ExperimentsPage apiBaseUrl={base} me={me} />}
  </main></ApiContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
