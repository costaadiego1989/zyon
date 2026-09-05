import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { LogOut, ShieldCheck, ExternalLink, ChevronDown, Search, X } from "lucide-react";
import { PageErrorBoundary } from "./PageErrorBoundary.js";
import { NAV_ITEMS, NAV_SECTIONS, visibleItemsForPlan, type TabKey } from "./nav-config.js";
import { resolveDashboardApiBaseUrl, type MerchantProfile as MerchantDashboardProfile } from "../api-client.js";
import { dashboardFetch } from "../api/http/client.js";
import { ToastContainer } from "../components/Toast.js";
import { FreeTrialNotice } from "../pages/billing-plans/FreeTrialNotice.js";
import { PlanProvider } from "../components/FeatureGate.js";
import { PremiumFeatureGate } from "../components/PremiumFeatureGate.js";
import { NotificationBell, type NotificationItem } from "../components/NotificationBell.js";
import { useSupportSocket } from "../hooks/useSupportSocket.js";
import { useNavCounts } from "./useNavCounts.js";
import { ImportProgressProvider } from "../components/spreadsheet-import/ImportProgressProvider.js";
import { ImportProgressBanner } from "../components/spreadsheet-import/ImportProgressBanner.js";
import { useCatalogApi } from "../hooks/api/useCatalogApi.js";
import { filterNavByRole } from "../lib/auth/permissions.js";
import { RestrictedAccessModal } from "../components/RestrictedAccessModal.js";
import { RouteGuard } from "../components/RouteGuard.js";
import { AccessModalProvider } from "../lib/auth/access-modal-context.js";

function ShellImportProgressProvider({ children }: { children: React.ReactNode }) {
  const catalog = useCatalogApi();
  return (
    <ImportProgressProvider getImportJob={catalog.getImportJob}>
      {children}
    </ImportProgressProvider>
  );
}

const API_BASE_URL = resolveDashboardApiBaseUrl(import.meta.env);

function getStorefrontUrl(slugOrId: string): string {
  const env = import.meta.env;
  const storefrontUrl = (env.VITE_STOREFRONT_URL as string | undefined)?.trim();
  if (storefrontUrl) return `${storefrontUrl}/store/${slugOrId}`;

  const apiUrl = new URL(API_BASE_URL);
  apiUrl.port = "3001";
  return `${apiUrl.origin}/store/${slugOrId}`;
}

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
  const resolveInitialTab = (): TabKey => {
    const hash = window.location.hash.slice(1);
    if (hash) return hash as TabKey;
    return initialTab ?? "overview";
  };
  const [tab, setTab] = useState<TabKey>(resolveInitialTab);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [hideOnboarding, setHideOnboarding] = useState(initialOnboardingCompleted !== false);
  const appliedOnboardingTabRef = React.useRef(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("aacp_nav_collapsed");
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch {
        return new Set();
      }
    }
    return new Set(NAV_SECTIONS.filter((s) => !s.defaultOpen).map((s) => s.id));
  });

  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) setTab(hash as TabKey);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Onboarding state resolves asynchronously in the parent (after
  // getOnboardingState). useState reads props only on mount, so react to
  // initialTab/onboardingCompleted landing after mount: reveal the nav item and
  // jump to the wizard once. One-shot ref keeps later manual navigation intact.
  useEffect(() => {
    if (initialOnboardingCompleted === false) {
      setHideOnboarding(false);
    }
    if (initialTab === "onboarding" && !appliedOnboardingTabRef.current) {
      appliedOnboardingTabRef.current = true;
      const hash = window.location.hash.slice(1);
      // Don't override an explicit hash the user landed on (e.g. deep link).
      if (!hash || hash === "onboarding") {
        setTab("onboarding");
        window.location.hash = "onboarding";
      }
    }
  }, [initialTab, initialOnboardingCompleted]);

  useEffect(() => {
    localStorage.setItem("aacp_nav_collapsed", JSON.stringify(Array.from(collapsedSections)));
  }, [collapsedSections]);

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

  const changeTab = useCallback((next: TabKey) => {
    setTab(next);
    window.location.hash = next;
  }, []);

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

  const socket = useSupportSocket(API_BASE_URL, me.id, me.name || undefined);
  const { counts: navCounts, markViewed: markBadgeViewed } = useNavCounts();

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

  React.useEffect(() => {
    let lastCheck = new Date().toISOString();
    let stopped = false;
    const poll = async () => {
      try {
        const res = await dashboardFetch(
          API_BASE_URL,
          `/merchants/${me.id}/notifications?since=${encodeURIComponent(lastCheck)}`,
        );
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
    void poll(); // immediate first check, then every 30s
    const timer = setInterval(() => { if (!stopped) void poll(); }, 30_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleNavItems = useMemo(
    () => {
      let items = hideOnboarding ? NAV_ITEMS.filter((item) => item.key !== "onboarding") : NAV_ITEMS;
      items = visibleItemsForPlan(items, me.plan ?? "BOTH");
      items = filterNavByRole(items, me.role);

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
    [hideOnboarding, me.plan, me.role, searchQuery]
  );

  const visibleSectionIds = useMemo(
    () => new Set(visibleNavItems.map((item) => item.section)),
    [visibleNavItems]
  );

  const orderedSections = useMemo(
    () =>
      NAV_SECTIONS.filter((s) => visibleSectionIds.has(s.id)).sort((a, b) => a.order - b.order),
    [visibleSectionIds]
  );

  const activeItem = visibleNavItems.find((item) => item.key === tab) ?? NAV_ITEMS[0]!;
  const ActiveIcon = activeItem.icon;
  const activeSection = activeItem.section;

  return (
    <>
    <AccessModalProvider>
    <PlanProvider merchantPlan={me.plan}>
      <ShellImportProgressProvider>
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
                      const rawCount = item.badgeKey
                        ? item.badgeKey === "cart-recovery"
                          ? navCounts.cartRecovery
                          : navCounts[item.badgeKey]
                        : 0;
                      const badgeCount = rawCount > 99 ? "99+" : rawCount > 0 ? String(rawCount) : null;

                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            if (item.badgeKey && rawCount > 0) {
                              markBadgeViewed(item.badgeKey);
                            }
                            changeTab(item.key);
                          }}
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
                          {badgeCount && (
                            <span style={{
                              minWidth: 18,
                              height: 18,
                              padding: "0 5px",
                              borderRadius: 9,
                              background: "var(--good)",
                              color: "oklch(13% 0.002 145)",
                              font: "600 10.5px var(--font-mono)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flex: "none"
                            }}>
                              {badgeCount}
                            </span>
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
                href={getStorefrontUrl(me.slug ?? me.id)}
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
          <FreeTrialNotice onViewPlans={() => changeTab("billing-plans")} />
          <PageErrorBoundary key={tab}>
            <Suspense fallback={<LoadingFallback />}>
            {tab === "onboarding" ? (
              <RouteGuard me={me} require="onboarding">
                <OnboardingWizard
                  apiBaseUrl={API_BASE_URL}
                  me={me}
                  onNavigate={(target: TabKey) => changeTab(target)}
                  onFinished={() => { setHideOnboarding(true); changeTab("overview"); }}
                />
              </RouteGuard>
            ) : null}
            {tab === "overview" ? (
              <RouteGuard me={me} require="overview">
                <OverviewPage apiBaseUrl={API_BASE_URL} defaultMerchantId={me.id} me={me} />
              </RouteGuard>
            ) : null}
            {tab === "rules" ? <RouteGuard me={me} require="rules"><MerchantRulesAuthenticatedPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "settings" ? <RouteGuard me={me} require="settings"><CheckoutSettingsPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "support" ? <RouteGuard me={me} require="support"><SupportSettingsPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {(tab === "integrations" || tab === "integrations-api") ? <RouteGuard me={me} require="integrations"><IntegrationsPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "crm-integrations" ? (
              <RouteGuard me={me} require="crm-integrations">
                <PremiumFeatureGate
                  feature="crmIntegrations"
                  requiredPlan="Growth"
                  featureLabel="CRM & Marketing"
                  description="Conecte sua loja a CRMs (HubSpot, Pipedrive, RD Station) e ferramentas de marketing automation para sincronizar leads e clientes."
                >
                  <CrmIntegrationsPage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "shipments" ? <RouteGuard me={me} require="shipments"><OrdersShipmentsPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "customers" ? <RouteGuard me={me} require="customers"><CustomersPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "funnel" ? <RouteGuard me={me} require="funnel"><FunnelPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "embed" ? <RouteGuard me={me} require="embed"><EmbedPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "theme" ? <RouteGuard me={me} require="theme"><ThemePage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "theme-checkout" ? <RouteGuard me={me} require="theme-checkout"><ThemePage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "billing" ? <RouteGuard me={me} require="billing"><BillingPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "billing-plans" ? <RouteGuard me={me} require="billing-plans"><BillingPlansPage /></RouteGuard> : null}
            {tab === "payment-connections" ? <RouteGuard me={me} require="payment-connections"><PaymentConnectionsPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "audit-log" ? <RouteGuard me={me} require="audit-log"><AuditLogPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "catalog" ? (
              <RouteGuard me={me} require="catalog">
                <CatalogPage
                  apiBaseUrl={API_BASE_URL}
                  me={me}
                  onCreate={() => { setEditingProductId(null); changeTab("product-detail"); }}
                  onEdit={(id) => { setEditingProductId(id); changeTab("product-detail"); }}
                />
              </RouteGuard>
            ) : null}
            {tab === "product-detail" ? (
              <RouteGuard me={me} require="product-detail">
                <ProductDetailPage
                  apiBaseUrl={API_BASE_URL}
                  me={me}
                  productId={editingProductId}
                  onBack={() => changeTab("catalog")}
                  onSaved={() => changeTab("catalog")}
                />
              </RouteGuard>
            ) : null}
            {tab === "categories" ? <RouteGuard me={me} require="categories"><CategoriesPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "store-settings" ? <RouteGuard me={me} require="store-settings"><StoreSettingsPage /></RouteGuard> : null}
            {tab === "custom-domain" ? <RouteGuard me={me} require="custom-domain"><CustomDomainPage /></RouteGuard> : null}
            {tab === "cross-sell" ? <RouteGuard me={me} require="cross-sell"><CrossSellPage context="store" /></RouteGuard> : null}
            {tab === "cross-sell-checkout" ? <RouteGuard me={me} require="cross-sell-checkout"><CrossSellPage context="checkout" /></RouteGuard> : null}
            {tab === "agent-config" ? <RouteGuard me={me} require="agent-config"><AgentConfigPage apiBaseUrl={API_BASE_URL} me={me} context="storefront" /></RouteGuard> : null}
            {tab === "agent-config-checkout" ? <RouteGuard me={me} require="agent-config-checkout"><AgentConfigPage apiBaseUrl={API_BASE_URL} me={me} context="checkout" /></RouteGuard> : null}
            {tab === "stories" ? <RouteGuard me={me} require="stories"><StoriesPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "team" ? <RouteGuard me={me} require="team"><TeamPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "account-settings" ? <RouteGuard me={me} require="account-settings"><AccountSettingsPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "marketplace" ? (
              <RouteGuard me={me} require="marketplace">
                <PremiumFeatureGate feature="marketplace" requiredPlan="Scale" featureLabel="Marketplace" description="Venda em rede com outras lojas, catálogo federado e settlement automático entre vendedores.">
                  <MarketplacePage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "whatsapp-seller" ? <RouteGuard me={me} require="whatsapp-seller"><WhatsAppSellerPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "coupons" ? <RouteGuard me={me} require="coupons"><CouponsPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "experiments" ? (
              <RouteGuard me={me} require="experiments">
                <PremiumFeatureGate feature="abTests" requiredPlan="Scale" featureLabel="Testes A/B" description="Experimente variações de prompts e estratégias do agente com significância estatística e promoção automática do vencedor.">
                  <ExperimentsPage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "revenue-lift" ? (
              <RouteGuard me={me} require="revenue-lift">
                <PremiumFeatureGate feature="revenueLift" requiredPlan="Scale" featureLabel="Impacto no Revenue" description="Meça o incremento real de receita gerado pela IA com grupos de holdout e atribuição científica.">
                  <RevenueLiftPage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "revenue-manager" ? (
              <RouteGuard me={me} require="revenue-manager">
                <PremiumFeatureGate feature="revenueManager" requiredPlan="Scale" featureLabel="Otimizador IA" description="IA autônoma que gera hipóteses de otimização e ajusta estratégias de conversão continuamente.">
                  <RevenueManagerPage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "cart-recovery" ? <RouteGuard me={me} require="cart-recovery"><CartRecoveryPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "m2m-agents" ? (
              <RouteGuard me={me} require="m2m-agents">
                <PremiumFeatureGate feature="m2mAgents" requiredPlan="Scale" featureLabel="Agentes M2M" description="Negociação máquina-a-máquina: agentes autônomos que negociam com compradores via protocolo dedicado.">
                  <M2MAgentsPage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "checkout-protocol" ? <RouteGuard me={me} require="checkout-protocol"><ProtocolPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "checkout-programavel" ? <RouteGuard me={me} require="checkout-programavel"><CheckoutProgramavelPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "intent-memory" ? (
              <RouteGuard me={me} require="intent-memory">
                <PremiumFeatureGate feature="intentMemory" requiredPlan="Scale" featureLabel="Memória de Intenção" description="IA personalizada que lembra o perfil e a intenção de compra de cada cliente (LGPD-compliant).">
                  <IntentMemoryPage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "inventory" ? <RouteGuard me={me} require="inventory"><InventoryPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "negotiation-policy" ? (
              <RouteGuard me={me} require="negotiation-policy">
                <PremiumFeatureGate feature="advancedRules" requiredPlan="Growth" featureLabel="Negociação" description="Política de negociação e barganha: o agente negocia descontos dentro dos limites que você define.">
                  <NegotiationPolicyPage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "chargebacks" ? <RouteGuard me={me} require="chargebacks"><ChargebacksPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "returns" ? <RouteGuard me={me} require="returns"><ReturnExchangesPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "delivery" ? <RouteGuard me={me} require="delivery"><DeliveryPage apiBaseUrl={API_BASE_URL} me={me} /></RouteGuard> : null}
            {tab === "post-sale" ? (
              <RouteGuard me={me} require="post-sale">
                <PremiumFeatureGate feature="postSale" requiredPlan="Growth" featureLabel="Pós-Venda" description="NPS, reviews, win-back, programa de fidelidade e reativação automática de clientes.">
                  <PostSalePage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            {tab === "knowledge" ? (
              <RouteGuard me={me} require="knowledge">
                <PremiumFeatureGate
                  feature="knowledgeBase"
                  requiredPlan="Growth"
                  featureLabel="Base de Conhecimento"
                  description="Alimente seu agente com FAQs, políticas e documentos da loja para respostas mais precisas e personalizadas."
                >
                  <KnowledgePage apiBaseUrl={API_BASE_URL} me={me} />
                </PremiumFeatureGate>
              </RouteGuard>
            ) : null}
            </Suspense>
          </PageErrorBoundary>
        </section>
      </main>
      <ToastContainer />
      <ImportProgressBanner />
      </div>
      </ShellImportProgressProvider>
    </PlanProvider>
    <RestrictedAccessModal />
    </AccessModalProvider>
    </>
  );
}
