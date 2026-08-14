import React, { lazy, Suspense, useMemo, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { PageErrorBoundary } from "./PageErrorBoundary.js";
import { NAV_ITEMS, type TabKey } from "./nav-config.js";
import { resolveDashboardApiBaseUrl, type MerchantProfile as MerchantDashboardProfile } from "../api-client.js";

const API_BASE_URL = resolveDashboardApiBaseUrl(import.meta.env);

// Lazy-loaded pages
const OverviewDemoPage = lazy(() => import("../pages/overview-demo-page.js").then(m => ({ default: m.OverviewDemoPage })));
const MerchantRulesAuthenticatedPage = lazy(() => import("../pages/merchant-rules-page.js").then(m => ({ default: m.MerchantRulesAuthenticatedPage })));
const CheckoutSettingsPage = lazy(() => import("../pages/checkout-settings/index.js").then(m => ({ default: m.CheckoutSettingsPage })));
const NegotiationPage = lazy(() => import("../pages/negotiation-page.js").then(m => ({ default: m.NegotiationPage })));
const SupportSettingsPage = lazy(() => import("../pages/support-settings-page.js").then(m => ({ default: m.SupportSettingsPage })));
const IntegrationsPage = lazy(() => import("../pages/integrations-page.js").then(m => ({ default: m.IntegrationsPage })));
const OrdersShipmentsPage = lazy(() => import("../pages/orders-shipments-page.js").then(m => ({ default: m.OrdersShipmentsPage })));
const CustomersPage = lazy(() => import("../pages/customers-page.js").then(m => ({ default: m.CustomersPage })));
const FunnelPage = lazy(() => import("../pages/funnel-page.js").then(m => ({ default: m.FunnelPage })));
const EmbedPage = lazy(() => import("../pages/embed-page.js").then(m => ({ default: m.EmbedPage })));
const ThemePage = lazy(() => import("../pages/theme-page.js").then(m => ({ default: m.ThemePage })));
const OnboardingWizard = lazy(() => import("../pages/onboarding-wizard.js").then(m => ({ default: m.OnboardingWizard })));
const CheckoutPreviewPage = lazy(() => import("../pages/preview-page.js").then(m => ({ default: m.CheckoutPreviewPage })));
const BillingPage = lazy(() => import("../pages/billing-page.js").then(m => ({ default: m.BillingPage })));
const PaymentConnectionsPage = lazy(() => import("../pages/payment-connections-page.js").then(m => ({ default: m.PaymentConnectionsPage })));
const AuditLogPage = lazy(() => import("../pages/audit-log-page.js").then(m => ({ default: m.AuditLogPage })));
const CommerceConnectionsPage = lazy(() => import("../pages/commerce-connections-page.js").then(m => ({ default: m.CommerceConnectionsPage })));

function LoadingFallback() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, font: "13px var(--sans)", color: "var(--faint)" }}>
      Carregando...
    </div>
  );
}

export interface DashboardShellProps {
  me: MerchantDashboardProfile;
  initialTab?: TabKey;
  onLogout: () => void;
}

export function DashboardShell({ me, initialTab, onLogout }: DashboardShellProps) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? "overview");

  const groupedSections = useMemo(() => [...new Set(NAV_ITEMS.map((item) => item.section))], []);

  const activeItem = NAV_ITEMS.find((item) => item.key === tab) ?? NAV_ITEMS[0]!;
  const ActiveIcon = activeItem.icon;
  const activeSection = activeItem.section;

  return (
    <div style={{ "--ink": "oklch(96% 0.002 145)", "--muted": "oklch(70% 0.006 145)", "--faint": "oklch(52% 0.006 145)", "--border": "oklch(27% 0.006 145)", "--bg": "oklch(13% 0.002 145)", "--card": "oklch(18.5% 0.004 145)", "--accent": "oklch(74% 0.19 149)", "--accent-dark": "oklch(60% 0.17 149)", "--accent-soft": "oklch(26% 0.05 149)", "--accent-line": "oklch(42% 0.1 149)", "--warn": "oklch(76% 0.15 80)", "--warn-soft": "oklch(26% 0.05 80)", "--good": "oklch(74% 0.17 149)", "--good-soft": "oklch(26% 0.05 149)", "--danger": "oklch(68% 0.18 25)", "--danger-soft": "oklch(28% 0.06 25)", "--sidebar-bg": "oklch(8% 0.002 145)", "--sidebar-border": "oklch(20% 0.006 145)", "--sidebar-text": "oklch(96% 0.002 145)", "--sidebar-muted": "oklch(58% 0.008 145)", "--sidebar-active": "oklch(23% 0.045 149)", "--serif": "'Source Serif 4', Georgia, 'Times New Roman', serif", "--mono": "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace", "--sans": "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif", display: "flex", width: "100%", minWidth: 1320, height: "100vh", minHeight: 720, background: "var(--bg)", fontFamily: "var(--sans)", color: "var(--ink)", letterSpacing: "-0.001em" } as React.CSSProperties}>
      {/* ── SIDEBAR ── */}
      <aside style={{ width: 252, flex: "none", background: "var(--sidebar-bg)", display: "flex", flexDirection: "column", padding: "20px 14px", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px 18px", borderBottom: "1px solid var(--sidebar-border)", marginBottom: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(150deg, var(--accent), var(--accent-dark))", display: "flex", alignItems: "center", justifyContent: "center", font: "600 14px var(--mono)", color: "white", flex: "none" }}>Z</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, font: "600 15px var(--serif)", letterSpacing: "-0.01em", color: "var(--sidebar-text)" }}>
              Zyon Console
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "oklch(70% 0.14 150)", flex: "none" }} />
            </div>
            <div style={{ font: "11px var(--mono)", color: "var(--sidebar-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.name || me.id}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px 14px" }}>
          <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 5, background: "var(--sidebar-active)", color: "var(--accent)" }}>PRODUÇÃO</span>
          <span style={{ font: "11px var(--mono)", color: "var(--sidebar-muted)" }}>v2.4</span>
        </div>
        <nav style={{ flex: 1 }} aria-label="Módulos do painel">
          {groupedSections.map((section) => (
            <div key={section} style={{ marginBottom: 16 }}>
              <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.08em", color: "var(--sidebar-muted)", padding: "0 10px 6px" }}>{section}</div>
              {NAV_ITEMS.filter((item) => item.section === section).map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 9, cursor: "pointer", marginBottom: 1, background: active ? "var(--sidebar-active)" : "transparent", border: "none", textAlign: "left", font: "inherit" }}
                  >
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: active ? "oklch(30% 0.03 149)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      <Icon size={14} color={active ? "var(--accent)" : "var(--sidebar-muted)"} />
                    </div>
                    <span style={{ font: "13px var(--sans)", color: active ? "var(--sidebar-text)" : "var(--sidebar-muted)", fontWeight: active ? 600 : 400, flex: 1 }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--sidebar-border)" }}>
          <button
            type="button"
            onClick={() => void onLogout()}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, cursor: "pointer", border: "none", background: "transparent", font: "inherit", textAlign: "left" }}
          >
            <LogOut size={16} color="oklch(62% 0.13 25)" />
            <span style={{ font: "13px var(--sans)", color: "oklch(62% 0.13 25)" }}>Sair</span>
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="dashboard-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", position: "relative", padding: 0 }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 32px", borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ActiveIcon size={17} color="var(--accent-dark)" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, font: "600 10.5px var(--mono)", letterSpacing: "0.04em", color: "var(--faint)" }}>
                {activeSection}<span style={{ color: "var(--faint)" }}>/</span><span style={{ color: "var(--accent-dark)" }}>{activeItem.label}</span>
              </div>
              <div style={{ font: "600 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.005em" }}>{activeItem.label}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", font: "12.5px var(--sans)", color: "var(--muted)" }}>
              <ShieldCheck size={14} />
              {me.name || me.id}
            </div>
          </div>
        </div>
        <section style={{ flex: 1, overflowY: "auto", padding: "48px 32px 60px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
          <PageErrorBoundary key={tab}>
            <Suspense fallback={<LoadingFallback />}>
            {tab === "onboarding" ? (
              <OnboardingWizard
                apiBaseUrl={API_BASE_URL}
                me={me}
                onNavigate={(target: TabKey) => setTab(target)}
                onFinished={() => setTab("overview")}
              />
            ) : null}
            {tab === "overview" ? (
              <OverviewDemoPage apiBaseUrl={API_BASE_URL} defaultMerchantId={me.id} me={me} />
            ) : null}
            {tab === "rules" ? <MerchantRulesAuthenticatedPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "settings" ? <CheckoutSettingsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "negotiation" ? <NegotiationPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "support" ? <SupportSettingsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "integrations" ? <IntegrationsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "shipments" ? <OrdersShipmentsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "customers" ? <CustomersPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "funnel" ? <FunnelPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "embed" ? <EmbedPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "preview" ? <CheckoutPreviewPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "theme" ? <ThemePage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "billing" ? <BillingPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "payment-connections" ? <PaymentConnectionsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "audit-log" ? <AuditLogPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "commerce-connections" ? <CommerceConnectionsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            </Suspense>
          </PageErrorBoundary>
        </section>
      </main>
    </div>
  );
}
