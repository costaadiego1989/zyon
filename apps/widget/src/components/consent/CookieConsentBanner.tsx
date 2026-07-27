import React, { useEffect, useState } from "react";

const CONSENT_KEY = "aacp_cookie_consent";

interface ConsentState {
  version: string;
  essential: boolean;
  analytics: boolean;
  timestamp: number;
}

function getStoredConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return raw ? (JSON.parse(raw) as ConsentState) : null;
  } catch {
    return null;
  }
}

function storeConsent(analytics: boolean): void {
  const consent: ConsentState = {
    version: "v1",
    essential: true,
    analytics,
    timestamp: Date.now(),
  };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
}

export function CookieConsentBanner({ privacyUrl }: { privacyUrl?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = getStoredConsent();
    if (!stored) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!visible) return null;

  function accept(): void {
    storeConsent(true);
    setVisible(false);
  }

  function reject(): void {
    storeConsent(false);
    setVisible(false);
  }

  return (
    <div
      role="region"
      aria-label="Preferências de cookies"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 420,
        zIndex: 999998,
        padding: "14px 18px",
        borderRadius: 14,
        background: "rgba(15, 15, 20, 0.95)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#e2e8f0",
        fontFamily: "inherit",
        fontSize: "12.5px",
        lineHeight: 1.5,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        animation: "aacp-consent-in 300ms ease-out both",
      }}
    >
      <style>{`
        @keyframes aacp-consent-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes aacp-consent-in { from, to { opacity: 1; transform: none; } }
        }
      `}</style>
      <p style={{ margin: 0, color: "#cbd5e1" }}>
        Usamos cookies essenciais para o funcionamento do checkout.
        {privacyUrl ? (
          <>
            {" "}Saiba mais na nossa{" "}
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#5eead4", textDecoration: "underline" }}
            >
              Política de Privacidade
            </a>
            .
          </>
        ) : null}
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={reject}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent",
            color: "#94a3b8",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Apenas essenciais
        </button>
        <button
          type="button"
          onClick={accept}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "none",
            background: "#0f766e",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Aceitar todos
        </button>
      </div>
    </div>
  );
}
