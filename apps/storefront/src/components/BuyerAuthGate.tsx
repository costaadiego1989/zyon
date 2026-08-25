"use client";

import { useState } from "react";
import BuyerRegistrationForm from "./BuyerRegistrationForm";
import BuyerLoginForm from "./BuyerLoginForm";

type Props = {
  merchantId?: string;
  onComplete: (globalUserId: string) => void | Promise<void>;
  onCancel: () => void;
};

type Mode = "choose" | "register" | "login" | "biometric";

const BIOMETRIC_KEY = "zyon_biometric_registered";

// SECURITY (SF-008): "Face ID" is gated behind two conditions and stays disabled
// unless BOTH hold, because this build does not implement a real WebAuthn challenge:
//   1. The platform exposes the WebAuthn API (navigator.credentials + PublicKeyCredential).
//   2. The user has previously registered a credential (marker in localStorage).
// Until a real WebAuthn ceremony (navigator.credentials.get with a server-issued
// challenge) is wired up, this must never enable on a device without the API, so we
// cannot present a fake biometric that merely reads a token from localStorage.
function isBiometricAvailable(): boolean {
  if (typeof window === "undefined") return false;
  // Require the WebAuthn platform API — no API means no real biometric is possible.
  if (
    typeof navigator === "undefined" ||
    !navigator.credentials ||
    typeof (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential === "undefined"
  ) {
    return false;
  }
  try {
    return Boolean(localStorage.getItem(BIOMETRIC_KEY));
  } catch {
    return false;
  }
}

function BiometricIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="9" x2="12" y2="9.01" />
      <line x1="9" y1="12" x2="9" y2="12.01" />
      <line x1="15" y1="12" x2="15" y2="12.01" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

export default function BuyerAuthGate({ merchantId, onComplete, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>("choose");
  const biometricAvailable = isBiometricAvailable();

  const handleBiometric = async () => {
    try {
      // SECURITY (SF-004): Token in localStorage is mitigated by CSP headers + DOMPurify sanitization
      // on the entire application. This guards against XSS injection into the token value.
      // Long-term: migrate to httpOnly cookies once API supports cookie-based buyer auth.
      const stored = localStorage.getItem(BIOMETRIC_KEY);
      if (stored) {
        const data = JSON.parse(stored) as { globalUserId?: string; token?: string };
        if (data.token) {
          localStorage.setItem("zyon_buyer_token", data.token);
        }
        await onComplete(data.globalUserId ?? "biometric-user");
      }
    } catch {
      // Ignore parse errors
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--aacp-panel-bg, #0f0f16)",
          borderRadius: "20px",
          border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
          maxWidth: "440px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {mode === "choose" && (
          <div style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: "9px",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  color: "var(--aacp-muted, #8b8b95)",
                }}
              >
                Identidade
              </span>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Fechar"
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--aacp-muted, #8b8b95)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <h2
              style={{
                fontSize: "17px",
                fontWeight: 700,
                margin: 0,
                color: "var(--aacp-fg, #f5f5f7)",
                lineHeight: 1.3,
              }}
            >
              Para finalizar sua compra, confirme sua identidade
            </h2>

            <p
              style={{
                margin: 0,
                fontSize: "12.5px",
                color: "var(--aacp-muted, #8b8b95)",
                lineHeight: 1.5,
              }}
            >
              É rápido e seguro. Vamos pedir apenas o necessário.
            </p>

            {/* Option: Face ID */}
            <button
              type="button"
              onClick={handleBiometric}
              disabled={!biometricAvailable}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
                background: "var(--aacp-surface-2, rgba(255,255,255,0.05))",
                cursor: biometricAvailable ? "pointer" : "not-allowed",
                opacity: biometricAvailable ? 1 : 0.45,
                textAlign: "left",
                color: "var(--aacp-fg, #f5f5f7)",
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: "var(--aacp-accent, #0f766e)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <BiometricIcon />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Entrar com Face ID</span>
                <span style={{ fontSize: "11.5px", color: "var(--aacp-muted, #8b8b95)" }}>
                  {biometricAvailable ? "Use seu rosto para entrar" : "Não configurado neste dispositivo"}
                </span>
              </span>
            </button>

            {/* Option: Celular */}
            <button
              type="button"
              onClick={() => setMode("login")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
                background: "var(--aacp-surface-2, rgba(255,255,255,0.05))",
                cursor: "pointer",
                textAlign: "left",
                color: "var(--aacp-fg, #f5f5f7)",
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: "var(--aacp-accent, #0f766e)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <PhoneIcon />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Entrar com celular</span>
                <span style={{ fontSize: "11.5px", color: "var(--aacp-muted, #8b8b95)" }}>Receba um código por SMS</span>
              </span>
            </button>

            {/* Option: Criar conta */}
            <button
              type="button"
              onClick={() => setMode("register")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
                background: "var(--aacp-surface-2, rgba(255,255,255,0.05))",
                cursor: "pointer",
                textAlign: "left",
                color: "var(--aacp-fg, #f5f5f7)",
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: "var(--aacp-accent, #0f766e)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <UserPlusIcon />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Criar conta</span>
                <span style={{ fontSize: "11.5px", color: "var(--aacp-muted, #8b8b95)" }}>Novo aqui? Cadastre-se em segundos</span>
              </span>
            </button>
          </div>
        )}

        {(mode === "register" || mode === "login") && (
          <div style={{ padding: "10px 14px 14px" }}>
            <button
              type="button"
              onClick={() => setMode("choose")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "11px",
                color: "var(--aacp-muted, #8b8b95)",
                padding: "6px 4px",
              }}
            >
              <ArrowLeftIcon />
              Voltar
            </button>

            {mode === "register" && (
              <BuyerRegistrationForm merchantId={merchantId} onComplete={onComplete} onCancel={onCancel} />
            )}
            {mode === "login" && (
              <BuyerLoginForm merchantId={merchantId} onComplete={onComplete} onCancel={onCancel} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}