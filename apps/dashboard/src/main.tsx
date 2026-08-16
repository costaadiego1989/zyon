import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type MerchantProfile as MerchantDashboardProfile,
  type MerchantTheme,
  DashboardHttpError,
  SESSION_EXPIRED_EVENT,
  resolveDashboardApiBaseUrl
} from "./api-client.js";
import { AuthScreen, type AuthMode } from "./auth/AuthScreen.js";
import { friendlyAuthError } from "./auth/auth-error.js";
import { DashboardShell } from "./shell/DashboardShell.js";
import type { TabKey } from "./shell/nav-config.js";
import { ApiContext, useApiInstance } from "./hooks/useApi.js";
import "./styles.css";

const API_BASE_URL = resolveDashboardApiBaseUrl(import.meta.env);

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
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [initialTab, setInitialTab] = useState<TabKey | undefined>(undefined);
  const [onboardingCompleted, setOnboardingCompleted] = useState(true);

  async function refreshSession() {
    try {
      const profile = await api.merchantProfile();
      setMe(profile);
      setAuthHint(null);
      try {
        const onboarding = await api.getOnboardingState();
        setOnboardingCompleted(onboarding.completed);
        if (!onboarding.completed && checkingSession) setInitialTab("onboarding");
      } catch {
        // Onboarding state is best-effort; never block console access.
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

  async function handleRegister(payload: { merchant_name: string; email: string; password: string }) {
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

  async function handleSaveCompanyData(data: { company: Record<string, unknown>; social?: Record<string, unknown> }) {
    await api.putStoreSettings(data);
  }

  async function handleSignupComplete() {
    await api.completeOnboardingStep("account");
    await refreshSession();
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
        onComplete={handleSignupComplete}
        apiBaseUrl={API_BASE_URL}
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
