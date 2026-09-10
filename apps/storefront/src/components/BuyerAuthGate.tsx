"use client";

import { useEffect, useState } from "react";
import { BuyerBiometricAccess } from "./BuyerBiometricAccess";
import BuyerRegistrationForm from "./BuyerRegistrationForm";
import BuyerLoginForm from "./BuyerLoginForm";
import { getValidBuyer } from "@/lib/buyer-auth";

type Props = {
  merchantId?: string;
  merchantName?: string;
  onComplete: (globalUserId: string) => void | Promise<void>;
  onCancel: () => void;
};

type Mode = "choose" | "register" | "login" | "biometric";
type RegistrationOtp = { email: string; otp: string };

function EmailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
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

export default function BuyerAuthGate({ merchantId, merchantName, onComplete, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>("choose");
  const [registrationOtp, setRegistrationOtp] = useState<RegistrationOtp | null>(null);

  useEffect(() => {
    const buyer = getValidBuyer();
    if (buyer) {
      void onComplete(buyer.globalUserId);
    }
  }, []);

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
            {}
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

            {}
            <BuyerBiometricAccess onComplete={onComplete} />

            {}
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
                <EmailIcon />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Entrar com e-mail</span>
                <span style={{ fontSize: "11.5px", color: "var(--aacp-muted, #8b8b95)" }}>Receba um código de acesso no seu e-mail</span>
              </span>
            </button>

            {}
            <button
              type="button"
              onClick={() => {
                setRegistrationOtp(null);
                setMode("register");
              }}
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
              <BuyerRegistrationForm
                merchantId={merchantId}
                merchantName={merchantName}
                onComplete={onComplete}
                onCancel={onCancel}
                initialEmail={registrationOtp?.email}
                initialEmailOtp={registrationOtp?.otp}
              />
            )}
            {mode === "login" && (
              <BuyerLoginForm
                merchantId={merchantId}
                merchantName={merchantName}
                onComplete={onComplete}
                onCancel={onCancel}
                onAccountNotFound={(credentials) => {
                  setRegistrationOtp(credentials);
                  setMode("register");
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
