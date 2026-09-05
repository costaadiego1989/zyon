import React, { useEffect, useRef, useState } from "react";

export interface OAuthCallbackResult {
  onboarding_required: boolean;
  profile: { name: string; email: string };
}

export interface OAuthCallbackProps {
  apiBaseUrl: string;
  onSuccess: (result: OAuthCallbackResult) => void;
  onError: (msg: string) => void;
}

/** Exchanges the short-lived provider code for the application's secure cookie. */
export function OAuthCallback({ apiBaseUrl, onSuccess, onError }: OAuthCallbackProps) {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    void exchange(controller.signal).finally(() => window.clearTimeout(timeout));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exchange(signal: AbortSignal) {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const provider = params.get("provider") || detectProvider();
    const savedState = sessionStorage.getItem("oauth_state");

    if (!code || !state || !provider) return fail("O retorno do provedor esta incompleto. Tente novamente.");
    if (!savedState || savedState !== state) return fail("A sessao de login expirou. Tente novamente.");

    try {
      const base = apiBaseUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/auth/oauth/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal,
        body: JSON.stringify({ provider, code, state }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<OAuthCallbackResult> & { message?: string };
      if (!res.ok) throw new Error(body.message || "Nao foi possivel concluir o login.");

      sessionStorage.removeItem("oauth_state");
      sessionStorage.removeItem("oauth_provider");
      window.history.replaceState({}, "", "/");
      onSuccess({
        onboarding_required: body.onboarding_required === true,
        profile: { name: body.profile?.name ?? "", email: body.profile?.email ?? "" },
      });
    } catch (cause) {
      const message = cause instanceof DOMException && cause.name === "AbortError"
        ? "O login demorou demais. Verifique sua conexao e tente novamente."
        : cause instanceof Error ? cause.message : "Nao foi possivel concluir o login.";
      fail(message);
    }
  }

  function fail(message: string) {
    setError(message);
    onError(message);
  }

  if (error) {
    return (
      <main className="auth-shell" style={{ alignItems: "center", justifyContent: "center" }}>
        <section className="auth-form" style={{ maxWidth: 460, padding: 32 }}>
          <h1 className="auth-form__title">Nao foi possivel entrar</h1>
          <p className="auth-form__subtitle">{error}</p>
          <button type="button" className="auth-cta" onClick={() => window.location.assign("/")}>Tentar novamente</button>
        </section>
      </main>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <p style={{ color: "var(--text, #ccc)", fontSize: 14 }}>Autenticando...</p>
    </div>
  );
}

function detectProvider(): string | null {
  const path = window.location.pathname;
  if (path.includes("github")) return "github";
  if (path.includes("google")) return "google";
  return sessionStorage.getItem("oauth_provider");
}
