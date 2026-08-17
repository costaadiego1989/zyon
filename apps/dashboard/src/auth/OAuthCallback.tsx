import React, { useEffect, useState } from "react";

export interface OAuthCallbackProps {
  apiBaseUrl: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

/**
 * Handles the /auth/oauth/callback route.
 * Reads provider, code, state from URL, validates state, calls API.
 */
export function OAuthCallback({ apiBaseUrl, onSuccess, onError }: OAuthCallbackProps) {
  const [status, setStatus] = useState<"loading" | "error">("loading");

  useEffect(() => {
    void handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const provider = params.get("provider") || detectProviderFromUrl();

    if (!code || !state || !provider) {
      setStatus("error");
      onError("Parâmetros OAuth inválidos.");
      return;
    }

    // Validate state matches what we stored
    const savedState = sessionStorage.getItem("oauth_state");
    if (!savedState || savedState !== state) {
      setStatus("error");
      onError("Estado OAuth inválido. Tente novamente.");
      return;
    }

    sessionStorage.removeItem("oauth_state");

    try {
      const base = apiBaseUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/auth/oauth/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider, code, state }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((body.message as string) || "Falha na autenticação OAuth");
      }

      // Clean up URL
      window.history.replaceState({}, "", "/");
      onSuccess();
    } catch (err) {
      setStatus("error");
      onError((err as Error).message);
    }
  }

  if (status === "error") {
    return null; // Error handled by parent via onError
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <p style={{ color: "var(--text, #ccc)", fontSize: 14 }}>Autenticando...</p>
    </div>
  );
}

function detectProviderFromUrl(): string | null {
  const path = window.location.pathname;
  if (path.includes("github")) return "github";
  if (path.includes("google")) return "google";
  // Fallback: check saved provider
  const saved = sessionStorage.getItem("oauth_provider");
  sessionStorage.removeItem("oauth_provider");
  return saved;
}
