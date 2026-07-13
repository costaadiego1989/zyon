import React, { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Bot,
  Code2,
  CreditCard,
  KeyRound,
  Eye,
  LogOut,
  MessageSquare,
  PackageSearch,
  Palette,
  Rocket,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  UserPlus,
  UsersRound,
  Webhook,
  Zap,
  type LucideIcon
} from "lucide-react";
import {
  createDashboardApi,
  type MerchantProfile as MerchantDashboardProfile,
  DashboardHttpError,
  SESSION_EXPIRED_EVENT
} from "./api-client.js";
import { OverviewDemoPage } from "./pages/overview-demo-page.js";
import { MerchantRulesAuthenticatedPage } from "./pages/merchant-rules-page.js";
import { CheckoutSettingsPage } from "./pages/checkout-settings/index.js";
import { NegotiationPage } from "./pages/negotiation-page.js";
import { SupportSettingsPage } from "./pages/support-settings-page.js";
import { IntegrationsPage } from "./pages/integrations-page.js";
import { OrdersShipmentsPage } from "./pages/orders-shipments-page.js";
import { CustomersPage } from "./pages/customers-page.js";
import { EmbedPage } from "./pages/embed-page.js";
import { ThemePage } from "./pages/theme-page.js";
import { OnboardingWizard } from "./pages/onboarding-wizard.js";
import { CheckoutPreviewPage } from "./pages/preview-page.js";
import { BillingPage } from "./pages/billing-page.js";
import { PaymentConnectionsPage } from "./pages/payment-connections-page.js";
import { AuditLogPage } from "./pages/audit-log-page.js";
import { CommerceConnectionsPage } from "./pages/commerce-connections-page.js";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3009";
const DEFAULT_MERCHANT_ID = import.meta.env.VITE_MERCHANT_ID ?? "mrc_demo";

type TabKey =
  | "onboarding"
  | "overview"
  | "integrations"
  | "shipments"
  | "customers"
  | "embed"
  | "preview"
  | "theme"
  | "support"
  | "settings"
  | "rules"
  | "negotiation"
  | "billing"
  | "payment-connections"
  | "audit-log"
  | "commerce-connections";

type AuthMode = "login" | "signup";

const NAV_ITEMS: Array<{ key: TabKey; label: string; section: string; icon: LucideIcon }> = [
  { key: "onboarding", label: "Primeiros passos", section: "Começar", icon: Rocket },
  { key: "overview", label: "Operação", section: "Hoje", icon: BarChart3 },
  { key: "shipments", label: "Pedidos e envios", section: "Hoje", icon: PackageSearch },
  { key: "customers", label: "Clientes", section: "Hoje", icon: UsersRound },
  { key: "integrations", label: "Desenvolvedores", section: "Plataforma", icon: Webhook },
  { key: "commerce-connections", label: "Loja / Commerce", section: "Plataforma", icon: Store },
  { key: "embed", label: "Embed", section: "Plataforma", icon: Code2 },
  { key: "theme", label: "Tema", section: "Plataforma", icon: Palette },
  { key: "preview", label: "Preview", section: "Plataforma", icon: Eye },
  { key: "support", label: "Suporte", section: "Atendimento", icon: MessageSquare },
  { key: "settings", label: "Checkout", section: "Atendimento", icon: Settings2 },
  { key: "rules", label: "Agente", section: "Atendimento", icon: Bot },
  { key: "negotiation", label: "Negociação", section: "Atendimento", icon: SlidersHorizontal },
  { key: "billing", label: "Faturamento", section: "Conta", icon: CreditCard },
  { key: "payment-connections", label: "Pagamentos", section: "Conta", icon: Zap },
  { key: "audit-log", label: "Auditoria", section: "Conta", icon: ShieldCheck },
];

class PageErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PageErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel" style={{ textAlign: "center", padding: "var(--space-8)" }}>
          <p style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>Algo deu errado nesta página.</p>
          <p className="text-muted" style={{ marginBottom: "var(--space-4)", fontSize: "0.85rem" }}>
            {this.state.error.message.slice(0, 200)}
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function friendlyAuthError(error: unknown): string {
  const text =
    error instanceof DashboardHttpError ? error.responseBody : error instanceof Error ? error.message : String(error);
  if (text.includes("email_already_registered")) return "Este e-mail já está cadastrado.";
  if (text.includes("invalid_credentials")) return "E-mail ou senha inválidos.";
  if (text.includes("login_rate_limited")) return "Muitas tentativas. Tente novamente em alguns minutos.";
  return text.slice(0, 180) || "Não foi possível autenticar.";
}

function AuthScreen(props: {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  busy: boolean;
  hint: string | null;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  merchantName: string;
  setMerchantName: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <main style={{ display: "flex", width: "100%", height: "100vh", background: "oklch(10% 0.003 145)", fontFamily: "var(--sans, 'Manrope', sans-serif)", color: "oklch(96% 0.002 145)" }}>
      {/* ── Left: Brand / Copy ── */}
      <section style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "60px 64px", background: "linear-gradient(165deg, oklch(12% 0.01 149) 0%, oklch(8% 0.003 145) 100%)", position: "relative", overflow: "hidden" }} aria-label="AACP">
        {/* Decorative gradient orb */}
        <div style={{ position: "absolute", top: -120, right: -120, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, oklch(74% 0.19 149 / 0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -80, left: -80, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, oklch(60% 0.17 149 / 0.05) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 480 }}>
          {/* Brand lockup */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 48 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(150deg, oklch(74% 0.19 149), oklch(60% 0.17 149))", display: "flex", alignItems: "center", justifyContent: "center", font: "700 16px 'IBM Plex Mono', monospace", color: "white" }}>Z</div>
            <div>
              <div style={{ font: "700 18px 'Source Serif 4', serif", letterSpacing: "-0.01em", color: "oklch(96% 0.002 145)" }}>Zyon Console</div>
              <div style={{ font: "11px 'IBM Plex Mono', monospace", color: "oklch(52% 0.006 145)", marginTop: 2 }}>Merchant Platform</div>
            </div>
          </div>

          {/* Headline */}
          <h1 style={{ font: "600 32px 'Source Serif 4', serif", letterSpacing: "-0.02em", lineHeight: 1.25, color: "oklch(96% 0.002 145)", marginBottom: 16 }}>
            Controle operacional para vender, integrar e acompanhar pedidos.
          </h1>
          <p style={{ font: "15px 'Manrope', sans-serif", color: "oklch(62% 0.008 145)", lineHeight: 1.6, marginBottom: 32 }}>
            Checkout agêntico com IA que negocia, oferece e converte — tudo em um painel unificado.
          </p>

          {/* Proof points */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {["Webhooks assinados", "Tracking por API", "Embed seguro", "Multi-gateway"].map(item => (
              <span key={item} style={{ font: "500 11px 'IBM Plex Mono', monospace", padding: "6px 12px", borderRadius: 7, border: "1px solid oklch(27% 0.006 145)", background: "oklch(15% 0.003 145)", color: "oklch(70% 0.006 145)" }}>{item}</span>
            ))}
          </div>

          {/* Trust badge */}
          <div style={{ marginTop: 48, display: "flex", alignItems: "center", gap: 8, font: "11px 'IBM Plex Mono', monospace", color: "oklch(48% 0.006 145)" }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="oklch(48% 0.006 145)" strokeWidth="1.5"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5l8-3z" /></svg>
            Dados criptografados em trânsito e repouso · SOC 2 em andamento
          </div>
        </div>
      </section>

      {/* ── Right: Auth Form ── */}
      <section style={{ width: 460, flex: "none", display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px 48px", background: "oklch(14% 0.003 145)", borderLeft: "1px solid oklch(22% 0.006 145)" }} aria-label={props.mode === "login" ? "Entrar" : "Criar conta"}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 32, background: "oklch(10% 0.002 145)", borderRadius: 10, padding: 4 }} role="tablist" aria-label="Acesso">
          <button
            type="button"
            onClick={() => props.setMode("login")}
            style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", font: "600 12.5px 'Manrope', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: props.mode === "login" ? "oklch(20% 0.004 145)" : "transparent", color: props.mode === "login" ? "oklch(96% 0.002 145)" : "oklch(52% 0.006 145)", boxShadow: props.mode === "login" ? "0 1px 3px rgba(0,0,0,0.3)" : "none" }}
          >
            <KeyRound size={14} /> Entrar
          </button>
          <button
            type="button"
            onClick={() => props.setMode("signup")}
            style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", font: "600 12.5px 'Manrope', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: props.mode === "signup" ? "oklch(20% 0.004 145)" : "transparent", color: props.mode === "signup" ? "oklch(96% 0.002 145)" : "oklch(52% 0.006 145)", boxShadow: props.mode === "signup" ? "0 1px 3px rgba(0,0,0,0.3)" : "none" }}
          >
            <UserPlus size={14} /> Criar conta
          </button>
        </div>

        {/* Form */}
        <form onSubmit={props.onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ marginBottom: 4 }}>
            <p style={{ font: "500 11px 'IBM Plex Mono', monospace", letterSpacing: "0.04em", color: "oklch(52% 0.006 145)", marginBottom: 6 }}>{props.mode === "login" ? "Sessão merchant" : "Novo tenant"}</p>
            <h2 style={{ font: "600 22px 'Source Serif 4', serif", color: "oklch(96% 0.002 145)", letterSpacing: "-0.01em" }}>{props.mode === "login" ? "Acesse seu painel" : "Cadastre sua loja"}</h2>
          </div>

          {props.mode === "signup" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.03em", color: "oklch(62% 0.006 145)" }}>Nome da loja</label>
              <input
                value={props.merchantName}
                onChange={(event) => props.setMerchantName(event.target.value)}
                autoComplete="organization"
                placeholder="Northstar Atelier"
                required
                style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid oklch(27% 0.006 145)", background: "oklch(10% 0.002 145)", font: "14px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", outline: "none" }}
              />
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.03em", color: "oklch(62% 0.006 145)" }}>Email</label>
            <input
              type="email"
              value={props.email}
              onChange={(event) => props.setEmail(event.target.value)}
              autoComplete="username"
              placeholder="owner@loja.com"
              required
              style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid oklch(27% 0.006 145)", background: "oklch(10% 0.002 145)", font: "14px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", outline: "none" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.03em", color: "oklch(62% 0.006 145)" }}>Senha</label>
              {props.mode === "login" ? (
                <button type="button" onClick={() => {}} style={{ font: "11px 'Manrope', sans-serif", color: "oklch(74% 0.19 149)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Esqueceu a senha?</button>
              ) : null}
            </div>
            <input
              type="password"
              value={props.password}
              onChange={(event) => props.setPassword(event.target.value)}
              autoComplete={props.mode === "signup" ? "new-password" : "current-password"}
              placeholder={props.mode === "signup" ? "Mínimo 8 caracteres" : "••••••••"}
              minLength={4}
              required
              style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid oklch(27% 0.006 145)", background: "oklch(10% 0.002 145)", font: "14px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", outline: "none" }}
            />
          </div>

          {props.mode === "signup" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.03em", color: "oklch(62% 0.006 145)" }}>CNPJ / CPF (opcional)</label>
              <input
                type="text"
                placeholder="00.000.000/0001-00"
                style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid oklch(27% 0.006 145)", background: "oklch(10% 0.002 145)", font: "14px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", outline: "none" }}
              />
            </div>
          ) : null}

          {props.hint ? <p style={{ font: "12.5px 'Manrope', sans-serif", color: "oklch(68% 0.18 25)", padding: "10px 14px", borderRadius: 8, background: "oklch(28% 0.06 25)", border: "1px solid oklch(35% 0.08 25)" }}>{props.hint}</p> : null}

          <button
            type="submit"
            disabled={props.busy}
            style={{ padding: "13px 20px", borderRadius: 9, border: "none", background: "linear-gradient(150deg, oklch(74% 0.19 149), oklch(60% 0.17 149))", font: "600 13.5px 'Manrope', sans-serif", color: "white", cursor: props.busy ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: props.busy ? 0.6 : 1, marginTop: 4, boxShadow: "0 2px 8px oklch(60% 0.17 149 / 0.3)" }}
          >
            {props.mode === "login" ? <KeyRound size={15} /> : <UserPlus size={15} />}
            {props.busy ? "Aguarde..." : props.mode === "login" ? "Entrar" : "Criar conta"}
          </button>

          {props.mode === "signup" ? (
            <p style={{ font: "11px 'Manrope', sans-serif", color: "oklch(48% 0.006 145)", textAlign: "center", lineHeight: 1.5, marginTop: 8 }}>
              Ao criar conta, você concorda com os <span style={{ color: "oklch(74% 0.19 149)", cursor: "pointer" }}>Termos de Serviço</span> e <span style={{ color: "oklch(74% 0.19 149)", cursor: "pointer" }}>Política de Privacidade</span>.
            </p>
          ) : null}
        </form>

        {/* Footer */}
        <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid oklch(22% 0.006 145)", display: "flex", justifyContent: "center", gap: 16, font: "11px 'IBM Plex Mono', monospace", color: "oklch(48% 0.006 145)" }}>
          <span>© 2026 Zyon</span>
          <span style={{ color: "oklch(30% 0.006 145)" }}>·</span>
          <span style={{ cursor: "pointer", color: "oklch(62% 0.008 145)" }}>Docs</span>
          <span style={{ color: "oklch(30% 0.006 145)" }}>·</span>
          <span style={{ cursor: "pointer", color: "oklch(62% 0.008 145)" }}>Status</span>
        </div>
      </section>
    </main>
  );
}

function App() {
  const api = useMemo(() => createDashboardApi({ baseUrl: API_BASE_URL }), []);
  const [tab, setTab] = useState<TabKey>("overview");
  const [me, setMe] = useState<MerchantDashboardProfile | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  async function refreshSession() {
    try {
      const profile = await api.merchantProfile();
      setMe(profile);
      setAuthHint(null);
      // Resume the guided onboarding only on initial load (not after user navigation).
      try {
        const onboarding = await api.getOnboardingState();
        if (!onboarding.completed && checkingSession) setTab("onboarding");
      } catch {
        // Onboarding state is best-effort; never block console access.
      }
    } catch (err) {
      // BUG-AUTH-2 (P2): Only force login on 401 (truly unauthenticated).
      // Network blips (5xx, fetch failures) must NOT log the operator out —
      // show an "API unavailable" hint and preserve the session instead.
      if (err instanceof DashboardHttpError && err.status === 401) {
        setMe(null);
      } else {
        // Transient error: keep the session (me) as-is; surface a warning.
        setAuthHint("API indisponível. Recarregue a página para tentar novamente.");
      }
    } finally {
      setCheckingSession(false);
    }
  }

  useEffect(() => {
    void refreshSession();
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleSessionExpired() {
      setMe(null);
      setAuthMode("login");
      setAuthHint("Sessão expirada. Entre novamente.");
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setAuthHint(null);
    try {
      if (authMode === "signup") {
        await api.register({
          merchant_name: merchantName.trim(),
          email: email.trim(),
          password
        });
      } else {
        await api.login(email.trim(), password);
      }
      setPassword("");
      await refreshSession();
    } catch (e) {
      setMe(null);
      setAuthHint(friendlyAuthError(e));
    } finally {
      setBusy(false);
      setCheckingSession(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
    } catch {
      // local state still clears the console when the API is unreachable.
    } finally {
      setMe(null);
      setPassword("");
      setBusy(false);
      setAuthMode("login");
    }
  }

  if (!me) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        busy={busy || checkingSession}
        hint={checkingSession ? "Verificando sessão..." : authHint}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        merchantName={merchantName}
        setMerchantName={setMerchantName}
        onSubmit={submitAuth}
      />
    );
  }

  const groupedSections = [...new Set(NAV_ITEMS.map((item) => item.section))];

  const activeItem = NAV_ITEMS.find((item) => item.key === tab) ?? NAV_ITEMS[0]!;
  const ActiveIcon = activeItem.icon;
  const activeSection = activeItem.section;

  return (
    <div style={{ "--ink": "oklch(96% 0.002 145)", "--muted": "oklch(70% 0.006 145)", "--faint": "oklch(52% 0.006 145)", "--border": "oklch(27% 0.006 145)", "--bg": "oklch(13% 0.002 145)", "--card": "oklch(18.5% 0.004 145)", "--accent": "oklch(74% 0.19 149)", "--accent-dark": "oklch(60% 0.17 149)", "--accent-soft": "oklch(26% 0.05 149)", "--accent-line": "oklch(42% 0.1 149)", "--warn": "oklch(76% 0.15 80)", "--warn-soft": "oklch(26% 0.05 80)", "--good": "oklch(74% 0.17 149)", "--good-soft": "oklch(26% 0.05 149)", "--danger": "oklch(68% 0.18 25)", "--danger-soft": "oklch(28% 0.06 25)", "--sidebar-bg": "oklch(8% 0.002 145)", "--sidebar-border": "oklch(20% 0.006 145)", "--sidebar-text": "oklch(96% 0.002 145)", "--sidebar-muted": "oklch(58% 0.008 145)", "--sidebar-active": "oklch(23% 0.045 149)", "--serif": "'Source Serif 4', Georgia, 'Times New Roman', serif", "--mono": "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace", "--sans": "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif", display: "flex", width: "100%", minWidth: 1320, height: "100vh", minHeight: 720, background: "var(--bg)", fontFamily: "var(--sans)", color: "var(--ink)", letterSpacing: "-0.001em" } as React.CSSProperties}>
      {/* ── SIDEBAR ── */}
      <aside style={{ width: 252, flex: "none", background: "var(--sidebar-bg)", display: "flex", flexDirection: "column", padding: "20px 14px", overflowY: "auto" }}>
        {/* Brand */}
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

        {/* Env badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px 14px" }}>
          <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 5, background: "var(--sidebar-active)", color: "var(--accent)" }}>PRODUÇÃO</span>
          <span style={{ font: "11px var(--mono)", color: "var(--sidebar-muted)" }}>v2.4</span>
        </div>

        {/* Nav groups */}
        <nav style={{ flex: 1 }} aria-label="Módulos do painel">
          {groupedSections.map((section) => (
            <div key={section} style={{ marginBottom: 16 }}>
              <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.08em", color: "var(--sidebar-muted)", padding: "0 10px 6px" }}>{section}</div>
              {NAV_ITEMS.filter((item) => item.section === section).map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <div
                    key={item.key}
                    onClick={() => setTab(item.key)}
                    style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 9, cursor: "pointer", marginBottom: 1, background: active ? "var(--sidebar-active)" : "transparent" }}
                  >
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: active ? "oklch(30% 0.03 149)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      <Icon size={14} color={active ? "var(--accent)" : "var(--sidebar-muted)"} />
                    </div>
                    <span style={{ font: "13px var(--sans)", color: active ? "var(--sidebar-text)" : "var(--sidebar-muted)", fontWeight: active ? 600 : 400, flex: 1 }}>{item.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer / logout */}
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--sidebar-border)" }}>
          <div
            onClick={() => void logout()}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, cursor: "pointer" }}
          >
            <LogOut size={16} color="oklch(62% 0.13 25)" />
            <span style={{ font: "13px var(--sans)", color: "oklch(62% 0.13 25)" }}>Sair</span>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="dashboard-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", position: "relative", padding: 0 }}>
        {/* Header bar */}
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

        {/* Scrollable content */}
        <section style={{ flex: 1, overflowY: "auto", padding: "48px 32px 60px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
          <PageErrorBoundary key={tab}>
          {tab === "onboarding" ? (
            <OnboardingWizard
              apiBaseUrl={API_BASE_URL}
              me={me}
              onNavigate={(target) => setTab(target)}
              onFinished={() => setTab("overview")}
            />
          ) : null}
          {tab === "overview" ? (
            <OverviewDemoPage apiBaseUrl={API_BASE_URL} defaultMerchantId={me.id || DEFAULT_MERCHANT_ID} me={me} />
          ) : null}
          {tab === "rules" ? <MerchantRulesAuthenticatedPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "settings" ? <CheckoutSettingsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "negotiation" ? <NegotiationPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "support" ? <SupportSettingsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "integrations" ? <IntegrationsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "shipments" ? <OrdersShipmentsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "customers" ? <CustomersPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "embed" ? <EmbedPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "preview" ? <CheckoutPreviewPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "theme" ? <ThemePage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "billing" ? <BillingPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "payment-connections" ? <PaymentConnectionsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "audit-log" ? <AuditLogPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          {tab === "commerce-connections" ? <CommerceConnectionsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
          </PageErrorBoundary>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
