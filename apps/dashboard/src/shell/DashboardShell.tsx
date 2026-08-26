import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { LogOut, ShieldCheck, ExternalLink, ChevronDown, Search, X } from "lucide-react";
import { PageErrorBoundary } from "./PageErrorBoundary.js";
import { NAV_ITEMS, NAV_SECTIONS, visibleItemsForPlan, type TabKey } from "./nav-config.js";
import { resolveDashboardApiBaseUrl, type MerchantProfile as MerchantDashboardProfile } from "../api-client.js";
import { ToastContainer } from "../components/Toast.js";
import { FeatureGate, PlanProvider } from "../components/FeatureGate.js";
import { NotificationBell, type NotificationItem } from "../components/NotificationBell.js";
import { useSupportSocket } from "../hooks/useSupportSocket.js";

const API_BASE_URL = resolveDashboardApiBaseUrl(import.meta.env);

// Construct storefront URL
function getStorefrontUrl(merchantId: string): string {
  const env = import.meta.env;
  const storefrontUrl = (env.VITE_STOREFRONT_URL as string | undefined)?.trim();
  if (storefrontUrl) return `${storefrontUrl}/store/${merchantId}`;

  // Fallback: derive from API base URL
  const apiUrl = new URL(API_BASE_URL);
  apiUrl.port = "3001"; // storefront typically runs on 3001
  return `${apiUrl.origin}/store/${merchantId}`;
}

// Lazy-loaded pages
const OverviewPage = lazy(() => import("../pages/overview/index.js").then(m => ({ default: m.OverviewPage })));
const MerchantRulesAuthenticatedPage = lazy(() => import("../pages/merchant-rules-page.js").then(m => ({ default: m.MerchantRulesAuthenticatedPage })));
const CheckoutSettingsPage = lazy(() => import("../pages/checkout-settings/index.js").then(m => ({ default: m.CheckoutSettingsPage })));
const SupportSettingsPage = lazy(() => import("../pages/support-settings-page.js").then(m => ({ default: m.SupportSettingsPage })));
const IntegrationsPage = lazy(() => import("../pages/integrations-page.js").then(m => ({ default: m.IntegrationsPage })));
const CrmIntegrationsPage = lazy(() => import("../pages/crm-integrations/index.js").then(m => ({ default: m.IntegrationsPage })));
const OrdersShipmentsPage = lazy(() => import("../pages/orders-shipments-page.js").then(m => ({ default: m.OrdersShipmentsPage })));
const CustomersPage = lazy(() => import("../pages/customers-page.js").then(m => ({ default: m.CustomersPage })));
const FunnelPage = lazy(() => import("../pages/funnel/index.js").then(m => ({ default: m.FunnelPage })));
const EmbedPage = lazy(() => import("../pages/embed-page.js").then(m => ({ default: m.EmbedPage })));
const ThemePage = lazy(() => import("../pages/theme-page.js").then(m => ({ default: m.ThemePage })));
const OnboardingWizard = lazy(() => import("../pages/onboarding-wizard/index.js").then(m => ({ default: m.OnboardingWizard })));
const CheckoutPreviewPage = lazy(() => import("../pages/preview-page.js").then(m => ({ default: m.CheckoutPreviewPage })));
const BillingPage = lazy(() => import("../pages/billing-page.js").then(m => ({ default: m.BillingPage })));
const PaymentConnectionsPage = lazy(() => import("../pages/payment-connections/index.js").then(m => ({ default: m.PaymentConnectionsPage })));
const AuditLogPage = lazy(() => import("../pages/audit-log-page.js").then(m => ({ default: m.AuditLogPage })));
const CatalogPage = lazy(() => import("../pages/catalog-page.js").then(m => ({ default: m.CatalogPage })));
const ProductDetailPage = lazy(() => import("../pages/product-detail-page.js").then(m => ({ default: m.ProductDetailPage })));
const CategoriesPage = lazy(() => import("../pages/categories/index.js"));
const StoreSettingsPage = lazy(() => import("../pages/store-settings/index.js").then(m => ({ default: m.StoreSettingsPage })));
const AgentConfigPage = lazy(() => import("../pages/agent-config-page.js").then(m => ({ default: m.AgentConfigPage })));
const StoriesPage = lazy(() => import("../pages/stories-page.js").then(m => ({ default: m.StoriesPage })));
const BillingPlansPage = lazy(() => import("../pages/billing-plans/index.js").then(m => ({ default: m.BillingPlansPage })));
const TeamPage = lazy(() => import("../pages/team-page.js").then(m => ({ default: m.TeamPage })));
const AccountSettingsPage = lazy(() => import("../pages/account-settings-page.js").then(m => ({ default: m.AccountSettingsPage })));
const CustomDomainPage = lazy(() => import("../pages/custom-domains/index.js").then(m => ({ default: m.CustomDomainPage })));
const CrossSellPage = lazy(() => import("../pages/cross-sell/index.js").then(m => ({ default: m.CrossSellPage })));
const MarketplacePage = lazy(() => import("../pages/marketplace/index.js").then(m => ({ default: m.MarketplacePage })));
const WhatsAppSellerPage = lazy(() => import("../pages/whatsapp-seller/WhatsAppSellerPage.js").then(m => ({ default: m.WhatsAppSellerPage })));
const ExperimentsPage = lazy(() => import("../pages/experiments-page.js").then(m => ({ default: m.ExperimentsPage })));
const CouponsPage = lazy(() => import("../pages/coupons/index.js").then(m => ({ default: m.CouponsPage })));
const RevenueLiftPage = lazy(() => import("../pages/revenue-lift/index.js").then(m => ({ default: m.RevenueLiftPage })));
const RevenueManagerPage = lazy(() => import("../pages/revenue-manager/index.js").then(m => ({ default: m.RevenueManagerPage })));
const CartRecoveryPage = lazy(() => import("../pages/cart-recovery/index.js").then(m => ({ default: m.CartRecoveryPage })));
const M2MAgentsPage = lazy(() => import("../pages/m2m-agents/M2MAgentsPage.js").then(m => ({ default: m.M2MAgentsPage })));
const ProtocolPage = lazy(() => import("../pages/checkout-protocol/ProtocolPage.js").then(m => ({ default: m.ProtocolPage })));
const CheckoutProgramavelPage = lazy(() => import("../pages/checkout-programavel/CheckoutProgramavelPage.js").then(m => ({ default: m.CheckoutProgramavelPage })));
const IntentMemoryPage = lazy(() => import("../pages/intent-memory/IntentMemoryPage.js").then(m => ({ default: m.IntentMemoryPage })));
const InventoryPage = lazy(() => import("../pages/inventory/index.js").then(m => ({ default: m.InventoryPage })));
const NegotiationPolicyPage = lazy(() => import("../pages/negotiation-policy/NegotiationPolicyPage.js").then(m => ({ default: m.NegotiationPolicyPage })));
const ChargebacksPage = lazy(() => import("../pages/chargebacks/ChargebacksPage.js").then(m => ({ default: m.ChargebacksPage })));
const ReturnExchangesPage = lazy(() => import("../pages/returns/ReturnExchangesPage.js").then(m => ({ default: m.ReturnExchangesPage })));
const DeliveryPage = lazy(() => import("../pages/delivery/index.js").then(m => ({ default: m.DeliveryPage })));
const PostSalePage = lazy(() => import("../pages/post-sale/index.js").then(m => ({ default: m.PostSalePage })));
const KnowledgePage = lazy(() => import("../pages/knowledge/index.js").then(m => ({ default: m.KnowledgePage })));

import { PageLoader } from "../components/PageLoader.js";

function LoadingFallback() {
  return <PageLoader />;
}

export interface DashboardShellProps {
  me: MerchantDashboardProfile;
  initialTab?: TabKey;
  onLogout: () => void;
  onboardingCompleted?: boolean;
}

export function DashboardShell({ me, initialTab, onLogout, onboardingCompleted: initialOnboardingCompleted }: DashboardShellProps) {
  // DASH-017/018: URL hash-based routing for deep links & back button
  const resolveInitialTab = (): TabKey => {
    const hash = window.location.hash.slice(1);
    if (hash) return hash as TabKey;
    return initialTab ?? "overview";
  };
  const [tab, setTab] = useState<TabKey>(resolveInitialTab);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [hideOnboarding, setHideOnboarding] = useState(initialOnboardingCompleted !== false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Sidebar: collapsible sections state
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("aacp_nav_collapsed");
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch {
        return new Set();
      }
    }
    // Default: collapse sections with defaultOpen: false
    return new Set(NAV_SECTIONS.filter((s) => !s.defaultOpen).map((s) => s.id));
  });

  // Sidebar: search state
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Sync hash → tab on popstate / hashchange
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) setTab(hash as TabKey);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Persist collapsed sections to localStorage
  useEffect(() => {
    localStorage.setItem("aacp_nav_collapsed", JSON.stringify(Array.from(collapsedSections)));
  }, [collapsedSections]);

  // Keyboard shortcut: Cmd+K or Ctrl+K focuses search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape" && searchQuery) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchQuery]);

  // changeTab: update state + hash in one call
  const changeTab = useCallback((next: TabKey) => {
    setTab(next);
    window.location.hash = next;
  }, []);

  // Toggle section collapse
  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  // Connect to support socket for real-time handoff notifications
  const socket = useSupportSocket(API_BASE_URL, me.id, me.name || undefined);

  // Convert new tickets from socket into notifications
  React.useEffect(() => {
    if (socket.newTickets.length === 0) return;
    const newNotifs: NotificationItem[] = socket.newTickets.map((t) => ({
      id: t.id,
      type: "handoff" as const,
      title: `Novo chamado: ${t.buyerMessage.slice(0, 50)}`,
      ticketId: t.id,
      createdAt: new Date().toISOString(),
    }));
    setNotifications((prev) => [...newNotifs, ...prev]);
    socket.clearNewTickets();
  }, [socket.newTickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for return/chargeback notifications every 30s
  React.useEffect(() => {
    let lastCheck = new Date().toISOString();
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/merchants/${me.id}/notifications?since=${encodeURIComponent(lastCheck)}`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items) && data.items.length > 0) {
            const newNotifs: NotificationItem[] = data.items.map((item: any) => ({
              id: item.id,
              type: item.type,
              title: item.title,
              createdAt: item.createdAt,
            }));
            setNotifications((prev) => [...newNotifs, ...prev]);
          }
        }
        lastCheck = new Date().toISOString();
      } catch { /* non-blocking */ }
    };
    const timer = setInterval(poll, 30_000);
    return () => clearInterval(timer);
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleNavItems = useMemo(
    () => {
      let items = hideOnboarding ? NAV_ITEMS.filter((item) => item.key !== "onboarding") : NAV_ITEMS;
      // Filter by plan
      items = visibleItemsForPlan(items, me.plan);

      // If searching, filter by label + keywords
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        items = items.filter((item) => {
          const matches =
            item.label.toLowerCase().includes(q) ||
            (item.keywords?.some((kw) => kw.toLowerCase().includes(q)) ?? false);
          return matches;
        });
      }
      return items;
    },
    [hideOnboarding, me.plan, searchQuery]
  );

  // Collect sections that have at least one visible item
  const visibleSectionIds = useMemo(
    () => new Set(visibleNavItems.map((item) => item.section)),
    [visibleNavItems]
  );

  // Sort sections by order
  const orderedSections = useMemo(
    () =>
      NAV_SECTIONS.filter((s) => visibleSectionIds.has(s.id)).sort((a, b) => a.order - b.order),
    [visibleSectionIds]
  );

  const activeItem = visibleNavItems.find((item) => item.key === tab) ?? NAV_ITEMS[0]!;
  const ActiveIcon = activeItem.icon;
  const activeSection = activeItem.section;

  return (
    <PlanProvider merchantPlan={me.plan}>
      <div style={{ "--ink": "oklch(96% 0.002 145)", "--muted": "oklch(70% 0.006 145)", "--faint": "oklch(52% 0.006 145)", "--border": "oklch(27% 0.006 145)", "--bg": "oklch(13% 0.002 145)", "--card": "oklch(18.5% 0.004 145)", "--accent": "oklch(74% 0.19 149)", "--accent-dark": "oklch(60% 0.17 149)", "--accent-soft": "oklch(26% 0.05 149)", "--accent-line": "oklch(42% 0.1 149)", "--warn": "oklch(76% 0.15 80)", "--warn-soft": "oklch(26% 0.05 80)", "--good": "oklch(74% 0.17 149)", "--good-soft": "oklch(26% 0.05 149)", "--danger": "oklch(68% 0.18 25)", "--danger-soft": "oklch(28% 0.06 25)", "--sidebar-bg": "oklch(8% 0.002 145)", "--sidebar-border": "oklch(20% 0.006 145)", "--sidebar-text": "oklch(96% 0.002 145)", "--sidebar-muted": "oklch(58% 0.008 145)", "--sidebar-active": "oklch(23% 0.045 149)", "--serif": "'Source Serif 4', Georgia, 'Times New Roman', serif", "--mono": "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace", "--sans": "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif", display: "flex", width: "100%", minWidth: 1320, height: "100vh", minHeight: 720, background: "var(--bg)", fontFamily: "var(--sans)", color: "var(--ink)", letterSpacing: "-0.001em" } as React.CSSProperties}>
      {/* ── SIDEBAR ── */}
      <aside style={{ width: 252, flex: "none", background: "var(--sidebar-bg)", display: "flex", flexDirection: "column", padding: "20px 14px", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px 18px", borderBottom: "1px solid var(--sidebar-border)", marginBottom: 14 }}>
          <img src="/logo-zyon.png" alt="Zyon" style={{ width: 50, height: 50, borderRadius: 10, objectFit: "cover", flex: "none" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, font: "600 15px var(--serif)", letterSpacing: "-0.01em", color: "var(--sidebar-text)" }}>
              Zyon Console
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "oklch(70% 0.14 150)", flex: "none" }} />
            </div>
            <div style={{ font: "11px var(--mono)", color: "var(--sidebar-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.name || me.id}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px 14px" }}>
          <span style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 5, background: "var(--sidebar-active)", color: "var(--color-brand)" }}>PRODUÇÃO</span>
          <span style={{ font: "11px var(--font-mono)", color: "var(--sidebar-muted)" }}>v1.0</span>
        </div>

        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", marginBottom: 14, borderRadius: 9, background: "var(--sidebar-active)", border: "1px solid var(--sidebar-border)" }}>
          <Search size={14} color="var(--sidebar-muted)" style={{ flex: "none" }} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Cmd+K"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              font: "12px var(--font-sans)",
              color: "var(--sidebar-text)",
              outline: "none"
            } as React.CSSProperties}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <X size={14} color="var(--sidebar-muted)" />
            </button>
          )}
        </div>

        {/* Sections */}
        <nav style={{ flex: 1 }} aria-label="Módulos do painel">
          {orderedSections.map((section) => {
            const sectionItems = visibleNavItems.filter((item) => item.section === section.id);
            const isCollapsed = collapsedSections.has(section.id);
            const isSearchActive = searchQuery.trim().length > 0;
            const SectionIcon = section.icon;

            return (
              <div key={section.id} style={{ marginBottom: 16 }}>
                {/* Section header */}
                <button
                  type="button"
                  onClick={() => toggleSectionCollapse(section.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 10px 6px",
                    font: "600 10px var(--font-mono)",
                    letterSpacing: "0.08em",
                    color: "var(--sidebar-muted)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left"
                  }}
                >
                  <SectionIcon size={11} style={{ flex: "none", opacity: 0.5 }} />
                  <span>{section.label}</span>
                  {!isSearchActive && (
                    <>
                      <span style={{ marginLeft: "auto" }}>
                        ({sectionItems.length})
                      </span>
                      <ChevronDown
                        size={12}
                        style={{
                          flex: "none",
                          transition: "transform 0.2s",
                          transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)"
                        }}
                      />
                    </>
                  )}
                </button>

                {/* Section items */}
                {(isSearchActive || !isCollapsed) && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                      maxHeight: isCollapsed && !isSearchActive ? 0 : "none",
                      overflow: "hidden",
                      transition: "max-height 0.2s ease-out"
                    }}
                  >
                    {sectionItems.map((item) => {
                      const Icon = item.icon;
                      const active = tab === item.key;

                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => changeTab(item.key)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 9,
                            padding: "6px 8px",
                            borderRadius: 9,
                            cursor: "pointer",
                            background: active ? "var(--sidebar-active)" : "transparent",
                            border: "none",
                            textAlign: "left",
                            font: "inherit"
                          }}
                        >
                          <div style={{
                            width: 24,
                            height: 24,
                            borderRadius: 7,
                            background: active ? "oklch(30% 0.03 149)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flex: "none"
                          }}>
                            <Icon size={14} color={active ? "var(--color-brand)" : "var(--sidebar-muted)"} />
                          </div>
                          <span style={{
                            font: "13px var(--font-sans)",
                            color: active ? "var(--sidebar-text)" : "var(--sidebar-muted)",
                            fontWeight: active ? 600 : 400,
                            flex: 1
                          }}>
                            {item.label}
                          </span>
                          {item.badge && (
                            <span style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "var(--good)",
                              flex: "none"
                            }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Logout button */}
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--sidebar-border)" }}>
          <button
            type="button"
            onClick={() => void onLogout()}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, cursor: "pointer", border: "none", background: "transparent", font: "inherit", textAlign: "left" }}
          >
            <LogOut size={16} color="oklch(62% 0.13 25)" />
            <span style={{ font: "13px var(--font-sans)", color: "oklch(62% 0.13 25)" }}>Sair</span>
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="dashboard-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", position: "relative", padding: 0 }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 32px", borderBottom: "1px solid var(--color-border)", background: "var(--surface-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--color-brand-subtle)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ActiveIcon size={17} color="var(--color-brand-hover)" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, font: "600 10.5px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)" }}>
                {activeSection}<span style={{ color: "var(--color-text-faint)" }}>/</span><span style={{ color: "var(--color-brand-hover)" }}>{activeItem.label}</span>
              </div>
              <div style={{ font: "600 22px var(--font-serif)", color: "var(--color-text)", letterSpacing: "-0.005em" }}>{activeItem.label}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(me.plan === "STORE_ONLY" || me.plan === "BOTH") && (
              <a
                href={getStorefrontUrl(me.id)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, border: "1px solid var(--color-border)", background: "var(--surface-2)", font: "12.5px var(--font-sans)", color: "var(--color-brand)", textDecoration: "none", cursor: "pointer", transition: "background 0.15s" }}
              >
                <ExternalLink size={14} />
                Acessar loja
              </a>
            )}
            <NotificationBell
              notifications={notifications}
              onClear={() => setNotifications([])}
              onClickNotification={(n) => {
                if (n.ticketId) {
                  changeTab("support" as TabKey);
                }
                setNotifications((prev) => prev.filter((x) => x.id !== n.id));
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 9, border: "1px solid var(--color-border)", background: "var(--surface-2)", font: "12.5px var(--font-sans)", color: "var(--color-text-muted)" }}>
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
                onNavigate={(target: TabKey) => changeTab(target)}
                onFinished={() => { setHideOnboarding(true); changeTab("overview"); }}
              />
            ) : null}
            {tab === "overview" ? (
              <OverviewPage apiBaseUrl={API_BASE_URL} defaultMerchantId={me.id} me={me} />
            ) : null}
            {tab === "rules" ? <MerchantRulesAuthenticatedPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "settings" ? <CheckoutSettingsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "support" ? <SupportSettingsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {(tab === "integrations" || tab === "integrations-api") ? <IntegrationsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "crm-integrations" ? <CrmIntegrationsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "shipments" ? <OrdersShipmentsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "customers" ? <CustomersPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "funnel" ? <FunnelPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "embed" ? <EmbedPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "preview" ? <CheckoutPreviewPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "theme" ? <ThemePage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "theme-checkout" ? <ThemePage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "billing" ? <BillingPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "billing-plans" ? <BillingPlansPage /> : null}
            {tab === "payment-connections" ? <PaymentConnectionsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "audit-log" ? <AuditLogPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "catalog" ? (
              <CatalogPage
                apiBaseUrl={API_BASE_URL}
                me={me}
                onCreate={() => { setEditingProductId(null); changeTab("product-detail"); }}
                onEdit={(id) => { setEditingProductId(id); changeTab("product-detail"); }}
              />
            ) : null}
            {tab === "product-detail" ? (
              <ProductDetailPage
                apiBaseUrl={API_BASE_URL}
                me={me}
                productId={editingProductId}
                onBack={() => changeTab("catalog")}
                onSaved={() => changeTab("catalog")}
              />
            ) : null}
            {tab === "categories" ? <CategoriesPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "store-settings" ? <StoreSettingsPage /> : null}
            {tab === "custom-domain" ? <CustomDomainPage /> : null}
            {tab === "cross-sell" ? <CrossSellPage context="store" /> : null}
            {tab === "cross-sell-checkout" ? <CrossSellPage context="checkout" /> : null}
            {tab === "agent-config" ? <AgentConfigPage apiBaseUrl={API_BASE_URL} me={me} context="storefront" /> : null}
            {tab === "agent-config-checkout" ? <AgentConfigPage apiBaseUrl={API_BASE_URL} me={me} context="checkout" /> : null}
            {tab === "stories" ? <StoriesPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "team" ? <TeamPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "account-settings" ? <AccountSettingsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "marketplace" ? <MarketplacePage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "whatsapp-seller" ? <WhatsAppSellerPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "coupons" ? <CouponsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "experiments" ? <ExperimentsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "revenue-lift" ? <RevenueLiftPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "revenue-manager" ? <RevenueManagerPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "cart-recovery" ? <CartRecoveryPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "m2m-agents" ? <M2MAgentsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "checkout-protocol" ? <ProtocolPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "checkout-programavel" ? <CheckoutProgramavelPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "intent-memory" ? <IntentMemoryPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "inventory" ? <InventoryPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "negotiation-policy" ? <NegotiationPolicyPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "chargebacks" ? <ChargebacksPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "returns" ? <ReturnExchangesPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "delivery" ? <DeliveryPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "post-sale" ? <PostSalePage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            {tab === "knowledge" ? <KnowledgePage apiBaseUrl={API_BASE_URL} me={me} /> : null}
            </Suspense>
          </PageErrorBoundary>
        </section>
      </main>
      <ToastContainer />
      </div>
    </PlanProvider>
  );
}
