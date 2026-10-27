import React, { useEffect, useRef, useState } from "react";
import { readOAuthCallback } from "./auth-config.js";
import { mergeUrl } from "../api/http/url.js";

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
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    void exchange(controller.signal).finally(() => window.clearTimeout(timeout));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exchange(signal: AbortSignal) {
    try {
      const request = readOAuthCallback(window.location.search, sessionStorage.getItem("oauth_state"), sessionStorage.getItem("oauth_provider"), sessionStorage.getItem("oauth_code_verifier"));
      const res = await fetch(mergeUrl(apiBaseUrl, "/auth/oauth/callback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal,
        body: JSON.stringify(request),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<OAuthCallbackResult> & { message?: string; detail?: string };
      if (!res.ok) throw new Error(body.message || body.detail || (res.status >= 500
        ? "O serviço de login está temporariamente indisponível. Inicie uma nova tentativa."
        : "Não foi possível concluir o login. Inicie uma nova tentativa."));

      sessionStorage.removeItem("oauth_state");
      sessionStorage.removeItem("oauth_provider");
      sessionStorage.removeItem("oauth_code_verifier");
      window.history.replaceState({}, "", "/");
      onSuccess({
        onboarding_required: body.onboarding_required === true,
        profile: { name: body.profile?.name ?? "", email: body.profile?.email ?? "" },
      });
    } catch (cause) {
      const message = cause instanceof DOMException && cause.name === "AbortError"
        ? "O login demorou demais. Verifique sua conexão e tente novamente."
        : cause instanceof Error ? cause.message : "Não foi possível concluir o login.";
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
          <h1 className="auth-form__title">Não foi possível entrar</h1>
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
