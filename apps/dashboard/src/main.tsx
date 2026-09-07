import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type MerchantProfile as MerchantDashboardProfile,
  type MerchantTheme,
  DashboardHttpError,
  SESSION_EXPIRED_EVENT,
  resolveDashboardApiBaseUrl
} from "./api-client.js";
import { AuthScreen, type AuthMode } from "./auth/AuthScreen.js";
import { OAuthCallback, type OAuthCallbackResult } from "./auth/OAuthCallback.js";
import { friendlyAuthError } from "./auth/auth-error.js";
import { DashboardShell } from "./shell/DashboardShell.js";
import { LoadingSplash } from "./components/LoadingSplash.js";
import { PlanSelection } from "./pages/onboarding-wizard/steps/PlanSelection.js";
import type { TabKey } from "./shell/nav-config.js";
import { ApiContext, useApiInstance } from "./hooks/useApi.js";
import { reportError } from "./lib/observability/error-reporter.js";
import "./styles.css";

const API_BASE_URL = resolveDashboardApiBaseUrl(import.meta.env);

// Cloudflare Turnstile site key. Empty string disables the widget; the auth
// forms will skip sending `turnstile_token` and the API is configured the
// same way (skips verification when the secret is unset).
const TURNSTILE_SITE_KEY =
  (import.meta.env as Record<string, string | undefined>).VITE_TURNSTILE_SITE_KEY ?? "";

const BASE_THEME: MerchantTheme = {
  accentColor: "#0F766E",
  textColor: "#F7FAF7",
  backgroundColor: "#0A0F0A",
  fontFamily: "Manrope, sans-serif",
};

interface AppProps {
  api: ReturnType<typeof useApiInstance>;
}

function App({ api }: AppProps) {
  const [me, setMe] = useState<MerchantDashboardProfile | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("token") && window.location.pathname.includes("reset-password")) return "reset";
    return "login";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [oauthProfile, setOauthProfile] = useState<OAuthCallbackResult["profile"] | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [initialTab, setInitialTab] = useState<TabKey | undefined>(undefined);
  const [onboardingCompleted, setOnboardingCompleted] = useState(true);
  const [planSelectionPending, setPlanSelectionPending] = useState(false);
  const onboardingRedirectedRef = useRef(false);

  async function refreshSession() {
    try {
      const profile = await api.merchantProfile();
      const settings = await api.getStoreSettings();
      const choosingPlan = settings.plan_selection_pending === true;
      setPlanSelectionPending(choosingPlan);
      if (!choosingPlan && (settings.registration_pending === true || settings.oauth_registration_pending === true)) {
        const owner = await api.getMe();
        setOauthProfile({ name: owner.name ?? "", email: owner.email ?? "" });
        setAuthMode("signup");
        setMe(null);
        return;
      }
      setMe(profile);
      setAuthHint(null);
      try {
        const onboarding = await api.getOnboardingState();
        setOnboardingCompleted(onboarding.completed);
        // Open onboarding on first session resolution if incomplete.
        // One-shot flag prevents re-directing when user manually navigates away.
        if (!onboarding.completed && !onboardingRedirectedRef.current) {
          onboardingRedirectedRef.current = true;
          setInitialTab("onboarding");
        }
      } catch (err) {
        // Onboarding state is best-effort; never block console access.
        reportError({ source: "main.refreshSession.onboarding", error: err, severity: "warning" });
      }
    } catch (err) {
      if (err instanceof DashboardHttpError && err.status === 401) {
        setMe(null);
      } else {
        setMe(null);
      }
    } finally {
      setCheckingSession(false);
    }
  }

  useEffect(() => {
    if (window.location.pathname.includes("/oauth/callback")) {
      setCheckingSession(false);
      return;
    }
    void refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleSessionExpired() {
      if (checkingSession || !me) return;
      setMe(null);
      setAuthMode("login");
      setAuthHint("Sessão expirada. Entre novamente.");
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [checkingSession, me]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setAuthHint(null);
    try {
      if (authMode === "signup") {
        await api.register({
          merchant_name: merchantName.trim(),
          email: email.trim(),
          password,
          turnstile_token: captchaToken ?? undefined,
        });
      } else {
        await api.login(email.trim(), password, captchaToken ?? undefined);
      }
      setPassword("");
      setCaptchaToken(null);
      await refreshSession();
    } catch (e) {
      setMe(null);
      setCaptchaToken(null);
      setAuthHint(friendlyAuthError(e));
    } finally {
      setBusy(false);
      setCheckingSession(false);
    }
  }

  async function handleRegister(payload: { merchant_name: string; email: string; password: string; turnstile_token?: string }) {
    await api.register(payload);
  }

  async function handleSaveTheme(theme: { accentColor: string; logoUrl: string; headerTitle: string; agentName: string }) {
    const fullTheme: MerchantTheme = {
      ...BASE_THEME,
      accentColor: theme.accentColor,
      logoUrl: theme.logoUrl || undefined,
      headerTitle: theme.headerTitle,
      agentName: theme.agentName,
    };
    await api.putMerchantTheme(fullTheme);
  }

  async function handleSaveCompanyData(data: { slug?: string; company: Record<string, unknown>; social?: Record<string, unknown>; oauth_registration_pending?: boolean; owner_name?: string }) {
    await api.putStoreSettings({ ...data, registration_pending: true, plan_selection_pending: true });
    const storeName = data.company.razaoSocial;
    if (typeof storeName === "string" && storeName.trim()) await api.putStoreName(storeName.trim());
  }

  async function handleSaveOwner(data: { name: string; phone: string }) {
    await api.updateMe(data);
  }

  async function handleSignupComplete() {
    setOauthProfile(null);
    await refreshSession();
  }

  async function handlePlanComplete() {
    await api.completeOnboardingStep("account");
    await api.putStoreSettings({ registration_pending: false, oauth_registration_pending: false, plan_selection_pending: false });
    window.history.replaceState({}, "", "/");
    setPlanSelectionPending(false);
    setOauthProfile(null);
    await refreshSession();
  }

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
    } catch (err) {
      // local state still clears the console when the API is unreachable.
      reportError({ source: "main.logout", error: err, severity: "warning" });
    } finally {
      setMe(null);
      setPassword("");
      setBusy(false);
      setAuthMode("login");
    }
  }

  // Check if we're on OAuth callback route
  if (window.location.pathname.includes("/oauth/callback")) {
    return (
      <OAuthCallback
        apiBaseUrl={API_BASE_URL}
        onSuccess={(result) => {
          void refreshSession();
        }}
        onError={(msg) => {
          setAuthHint(msg);
          setCheckingSession(false);
        }}
      />
    );
  }

  if (checkingSession) return <LoadingSplash />;

  if (me && planSelectionPending) {
    return <main className="signup-plans"><PlanSelection merchantName={me.name} onDone={handlePlanComplete} /></main>;
  }

  if (!me) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        busy={busy}
        hint={authHint}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        merchantName={merchantName}
        setMerchantName={setMerchantName}
        onSubmit={submitAuth}
        onRegister={handleRegister}
        onSaveTheme={handleSaveTheme}
        onSaveCompanyData={handleSaveCompanyData}
        onSaveOwner={handleSaveOwner}
        onComplete={handleSignupComplete}
        oauthProfile={oauthProfile}
        turnstileSiteKey={TURNSTILE_SITE_KEY}
        captchaToken={captchaToken}
        setCaptchaToken={setCaptchaToken}
      />
    );
  }

  return <DashboardShell me={me} initialTab={initialTab} onLogout={logout} onboardingCompleted={onboardingCompleted} />;
}

function AppRoot() {
  const api = useApiInstance(API_BASE_URL);
  return (
    <ApiContext.Provider value={api}>
      <App api={api} />
    </ApiContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<AppRoot />);
