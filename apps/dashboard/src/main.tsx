import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Bot,
  Code2,
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
  UserPlus,
  UsersRound,
  Webhook,
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
import { CheckoutSettingsPage } from "./pages/checkout-settings-page.js";
import { NegotiationPage } from "./pages/negotiation-page.js";
import { SupportSettingsPage } from "./pages/support-settings-page.js";
import { IntegrationsPage } from "./pages/integrations-page.js";
import { OrdersShipmentsPage } from "./pages/orders-shipments-page.js";
import { CustomersPage } from "./pages/customers-page.js";
import { EmbedPage } from "./pages/embed-page.js";
import { ThemePage } from "./pages/theme-page.js";
import { OnboardingWizard } from "./pages/onboarding-wizard.js";
import { CheckoutPreviewPage } from "./pages/preview-page.js";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
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
  | "negotiation";

type AuthMode = "login" | "signup";

const NAV_ITEMS: Array<{ key: TabKey; label: string; section: string; icon: LucideIcon }> = [
  { key: "onboarding", label: "Primeiros passos", section: "Comecar", icon: Rocket },
  { key: "overview", label: "Operacao", section: "Hoje", icon: BarChart3 },
  { key: "shipments", label: "Pedidos e envios", section: "Hoje", icon: PackageSearch },
  { key: "customers", label: "Clientes", section: "Hoje", icon: UsersRound },
  { key: "integrations", label: "Desenvolvedores", section: "Plataforma", icon: Webhook },
  { key: "embed", label: "Embed", section: "Plataforma", icon: Code2 },
  { key: "preview", label: "Preview", section: "Plataforma", icon: Eye },
  { key: "theme", label: "Tema", section: "Plataforma", icon: Palette },
  { key: "support", label: "Suporte", section: "Atendimento", icon: MessageSquare },
  { key: "settings", label: "Checkout", section: "Atendimento", icon: Settings2 },
  { key: "rules", label: "Agente", section: "Atendimento", icon: Bot },
  { key: "negotiation", label: "Negociacao", section: "Atendimento", icon: SlidersHorizontal }
];

function friendlyAuthError(error: unknown): string {
  const text =
    error instanceof DashboardHttpError ? error.responseBody : error instanceof Error ? error.message : String(error);
  if (text.includes("email_already_registered")) return "Este email ja esta cadastrado.";
  if (text.includes("invalid_credentials")) return "Email ou senha invalidos.";
  if (text.includes("login_rate_limited")) return "Muitas tentativas. Tente novamente em alguns minutos.";
  return text.slice(0, 180) || "Nao foi possivel autenticar.";
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
    <main className="auth-screen">
      <section className="auth-copy" aria-label="AACP">
        <div className="brand-lockup">
          <span>AACP</span>
          <strong>Merchant Console</strong>
        </div>
        <div>
          <p className="eyebrow">Checkout assistido</p>
          <h1>Controle operacional para vender, integrar e acompanhar pedidos.</h1>
        </div>
        <div className="auth-proof-grid">
          <span>Webhooks assinados</span>
          <span>Tracking por API</span>
          <span>Embed seguro</span>
        </div>
      </section>

      <section className="auth-panel" aria-label={props.mode === "login" ? "Entrar" : "Criar conta"}>
        <div className="auth-tabs" role="tablist" aria-label="Acesso">
          <button
            type="button"
            className={props.mode === "login" ? "active" : ""}
            onClick={() => props.setMode("login")}
          >
            <KeyRound size={16} />
            Entrar
          </button>
          <button
            type="button"
            className={props.mode === "signup" ? "active" : ""}
            onClick={() => props.setMode("signup")}
          >
            <UserPlus size={16} />
            Criar conta
          </button>
        </div>

        <form className="auth-form" onSubmit={props.onSubmit}>
          <div>
            <p className="eyebrow">{props.mode === "login" ? "Sessao merchant" : "Novo tenant"}</p>
            <h2>{props.mode === "login" ? "Acesse seu painel" : "Cadastre sua loja"}</h2>
          </div>

          {props.mode === "signup" ? (
            <label>
              Nome da loja
              <input
                value={props.merchantName}
                onChange={(event) => props.setMerchantName(event.target.value)}
                autoComplete="organization"
                placeholder="Northstar Atelier"
                required
              />
            </label>
          ) : null}

          <label>
            Email
            <input
              type="email"
              value={props.email}
              onChange={(event) => props.setEmail(event.target.value)}
              autoComplete="username"
              placeholder="owner@loja.com"
              required
            />
          </label>

          <label>
            Senha
            <input
              type="password"
              value={props.password}
              onChange={(event) => props.setPassword(event.target.value)}
              autoComplete={props.mode === "signup" ? "new-password" : "current-password"}
              placeholder="Senha"
              minLength={4}
              required
            />
          </label>

          {props.hint ? <p className="auth-hint">{props.hint}</p> : null}

          <button className="primary-action" type="submit" disabled={props.busy}>
            {props.mode === "login" ? <KeyRound size={16} /> : <UserPlus size={16} />}
            {props.busy ? "Aguarde" : props.mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>
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
      // Resume the guided onboarding when provisioning is incomplete.
      try {
        const onboarding = await api.getOnboardingState();
        if (!onboarding.completed) setTab("onboarding");
      } catch {
        // Onboarding state is best-effort; never block console access.
      }
    } catch {
      setMe(null);
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
      setAuthHint("Sessao expirada. Entre novamente.");
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
        hint={checkingSession ? "Verificando sessao..." : authHint}
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

  const activeItem = NAV_ITEMS.find((item) => item.key === tab) ?? NAV_ITEMS[0]!;
  const groupedSections = [...new Set(NAV_ITEMS.map((item) => item.section))];

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="console-brand">
          <span>AACP</span>
          <div>
            <strong>{me.name}</strong>
            <small>{me.id}</small>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Modulos do painel">
          {groupedSections.map((section) => (
            <div className="nav-section" key={section}>
              <span>{section}</span>
              {NAV_ITEMS.filter((item) => item.section === section).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={tab === item.key ? "active" : ""}
                    onClick={() => setTab(item.key)}
                  >
                    <Icon size={17} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <button className="logout-button" type="button" onClick={() => void logout()} disabled={busy}>
          <LogOut size={16} />
          Sair
        </button>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">AACP Console</p>
            <h1>{activeItem.label}</h1>
          </div>
          <div className="dashboard-header-status">
            <ShieldCheck size={16} />
            <span>API {API_BASE_URL}</span>
          </div>
        </header>

        <section className="dashboard-content">
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
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
