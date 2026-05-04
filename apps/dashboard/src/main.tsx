import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createDashboardApi,
  type MerchantProfile as MerchantDashboardProfile,
  DashboardHttpError
} from "./api-client.js";
import { OverviewDemoPage } from "./pages/overview-demo-page.js";
import { MerchantRulesAuthenticatedPage } from "./pages/merchant-rules-page.js";
import { CheckoutSettingsPage } from "./pages/checkout-settings-page.js";
import { NegotiationPage } from "./pages/negotiation-page.js";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const DEFAULT_MERCHANT_ID = import.meta.env.VITE_MERCHANT_ID ?? "mrc_demo";

type TabKey = "overview" | "rules" | "settings" | "negotiation";

function App() {
  const api = useMemo(() => createDashboardApi({ baseUrl: API_BASE_URL }), []);
  const [tab, setTab] = useState<TabKey>("overview");
  const [me, setMe] = useState<MerchantDashboardProfile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginHint, setLoginHint] = useState<string | null>(null);

  async function refreshSessionHint() {
    try {
      const profile = await api.merchantProfile();
      setMe(profile);
      setLoginHint(null);
    } catch {
      setMe(null);
      setLoginHint(null);
    }
  }

  useEffect(() => {
    void refreshSessionHint();
    // apenas ao montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoginHint(null);
    try {
      await api.login(email.trim(), password);
      setPassword("");
      await refreshSessionHint();
    } catch (e) {
      const txt =
        e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
      setLoginHint(txt || "Credenciais invalidas");
      setMe(null);
    }
  }

  return (
    <main>
      <header className="topbar dash-top">
        <div>
          <h1>Merchant dashboard</h1>
          <p>
            API <code>{API_BASE_URL}</code> · demos públicas sem login e rotas JWT com cookie.
          </p>
        </div>
        <section className="login-bar">
          {me ? (
            <span className="session-pill">{me.name}</span>
          ) : (
            <form className="login-form" onSubmit={submitLogin}>
              <input
                aria-label="email"
                placeholder="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
              />
              <input
                aria-label="password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button type="submit">Entrar</button>
            </form>
          )}
          {loginHint ? <small className="login-hint">{loginHint}</small> : null}
        </section>
      </header>

      <nav className="dash-nav" aria-label="Modulos dashboard">
        <button type="button" className={tab === "overview" ? "dash-tab active" : "dash-tab"} onClick={() => setTab("overview")}>
          Visão geral (demo)
        </button>
        <button type="button" className={tab === "rules" ? "dash-tab active" : "dash-tab"} onClick={() => setTab("rules")}>
          Regras JWT
        </button>
        <button type="button" className={tab === "settings" ? "dash-tab active" : "dash-tab"} onClick={() => setTab("settings")}>
          Checkout settings
        </button>
        <button type="button" className={tab === "negotiation" ? "dash-tab active" : "dash-tab"} onClick={() => setTab("negotiation")}>
          Negociação técnica
        </button>
      </nav>

      {tab === "overview" ? (
        <OverviewDemoPage apiBaseUrl={API_BASE_URL} defaultMerchantId={DEFAULT_MERCHANT_ID} />
      ) : null}
      {tab === "rules" ? <MerchantRulesAuthenticatedPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
      {tab === "settings" ? <CheckoutSettingsPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
      {tab === "negotiation" ? <NegotiationPage apiBaseUrl={API_BASE_URL} me={me} /> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
