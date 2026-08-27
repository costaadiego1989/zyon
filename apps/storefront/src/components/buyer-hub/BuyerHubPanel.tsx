"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useBuyerHub, type TabType } from "@/lib/viewmodels/useBuyerHub";
import { getValidBuyer } from "@/lib/buyer-auth";
import ProfileTab from "./tabs/ProfileTab";
import { OrdersTab } from "./tabs/OrdersTab";
import { TrackingTab } from "./tabs/TrackingTab";
import ConversationsTab from "./tabs/ConversationsTab";
import PreferencesTab from "./tabs/PreferencesTab";
import LoyaltyTab from "./tabs/LoyaltyTab";
import { SettingsTab } from "./tabs/SettingsTab";

// ─── Constants ──────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
const AUTH_STORAGE_KEY = "aacp_buyer_auth_session";

// ─── Props ──────────────────────────────────────────────────────────────────

export interface BuyerHubPanelProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId?: string;
  onToggleTheme?: () => void;
}

// ─── Auth Session shape (persisted to localStorage) ─────────────────────────

interface AuthSession {
  global_user_id: string;
  email: string;
  access_token: string;
  expires_at: number;
  phone: string;
}

// ─── Tab definitions ────────────────────────────────────────────────────────

interface TabDef {
  key: TabType;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  {
    key: "profile",
    label: "Perfil",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    key: "orders",
    label: "Pedidos",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    key: "tracking",
    label: "Rastreio",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" rx="2" ry="2" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    key: "conversations",
    label: "Conversas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    key: "preferences",
    label: "Preferencias",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
  },
  {
    key: "loyalty",
    label: "Fidelidade",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    key: "settings",
    label: "Config",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPhone(value: string): string {
  const numbers = value.replace(/\D/g, "").slice(0, 11);
  if (numbers.length > 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
  if (numbers.length > 2) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  return numbers;
}

// ─── PhoneLoginForm ─────────────────────────────────────────────────────────

function PhoneLoginForm({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePhoneChange = useCallback((value: string) => {
    setPhone(formatPhone(value));
  }, []);

  async function handleSendCode() {
    const normalizedPhone = phone.replace(/\D/g, "");
    if (normalizedPhone.length < 10) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/buyer/phone/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.message ?? "Falha ao enviar codigo.");
        return;
      }
      setCodeSent(true);
    } catch {
      setError("Erro de rede ao enviar codigo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    const normalizedPhone = phone.replace(/\D/g, "");
    if (phoneCode.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/buyer/phone/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, code: phoneCode }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.message ?? "Codigo invalido.");
        return;
      }
      // Extract session data
      const globalUserId = payload.globalUserId ?? payload.global_user_id;
      const accessToken = payload.accessToken ?? payload.access_token;
      const email = payload.email ?? "";
      const expiresIn = payload.expiresIn ?? payload.expires_in ?? 3600;
      if (!globalUserId || !accessToken) {
        setError("Resposta invalida do servidor.");
        return;
      }
      // Persist to aacp_buyer_auth_session
      const newSession: AuthSession = {
        global_user_id: globalUserId,
        email,
        access_token: accessToken,
        expires_at: Date.now() + (expiresIn - 60) * 1000,
        phone: normalizedPhone,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newSession));
      // Sync shared checkout session keys
      try {
        localStorage.setItem("zyon_buyer_token", accessToken);
        localStorage.setItem("zyon_buyer_session", JSON.stringify({ globalUserId, token: accessToken, email }));
      } catch {}
      onAuthSuccess();
    } catch {
      setError("Erro de rede ao verificar codigo.");
    } finally {
      setLoading(false);
    }
  }

  const canSendCode = phone.replace(/\D/g, "").length >= 10;
  const canConfirmCode = codeSent && phoneCode.length === 6;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "24px 0" }}>
      {/* Icon */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "var(--aacp-surface-2)",
          border: "1px solid var(--aacp-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--aacp-muted)", marginBottom: "8px" }}>Conta segura</div>
        <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--aacp-fg)", marginBottom: "8px", lineHeight: 1.3 }}>Entrar com celular</div>
        <div style={{ fontSize: "13px", color: "var(--aacp-muted)", lineHeight: 1.5 }}>Acesse pedidos anteriores e conclua compras futuras com menos etapas.</div>
      </div>

      {/* Assurance strip */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "12px 16px",
        borderRadius: "10px",
        background: "var(--aacp-surface-2)",
        border: "1px solid var(--aacp-line)",
        fontSize: "13px",
        color: "var(--aacp-muted)",
        lineHeight: 1.4,
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-success, #22c55e)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span>Seu acesso e seus dados permanecem protegidos.</span>
      </div>

      {/* Form */}
      <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {!codeSent ? (
          <label style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-muted)" }}>Celular</span>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              border: "1px solid var(--aacp-line)",
              background: "var(--aacp-surface-3)",
              transition: "border-color 0.15s ease, background 0.15s ease",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
              <input
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(11) 99999-9999"
                aria-label="Numero do celular"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--aacp-fg)",
                  fontSize: "15px",
                  fontFamily: "inherit",
                }}
              />
            </div>
          </label>
        ) : (
          <label style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-muted)" }}>Codigo de verificacao</span>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              border: "1px solid var(--aacp-line)",
              background: "var(--aacp-surface-3)",
              transition: "border-color 0.15s ease, background 0.15s ease",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              <input
                value={phoneCode}
                onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                aria-label="Codigo de verificacao"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--aacp-fg)",
                  fontSize: "15px",
                  fontFamily: "inherit",
                  letterSpacing: "4px",
                  textAlign: "center",
                }}
              />
            </div>
          </label>
        )}

        {codeSent && (
          <p style={{ fontSize: "13px", color: "var(--aacp-muted)", textAlign: "center" }} role="status">
            Codigo enviado para {phone}
          </p>
        )}

        {error && (
          <p style={{ fontSize: "13px", color: "#ef4444", textAlign: "center", padding: "6px 0" }} role="alert">{error}</p>
        )}

        <button
          type="button"
          disabled={loading || (!codeSent && !canSendCode) || (codeSent && !canConfirmCode)}
          onClick={() => { codeSent ? handleVerifyCode() : handleSendCode(); }}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            background: "var(--aacp-accent)",
            color: "#fff",
            border: "none",
            cursor: loading || (!codeSent && !canSendCode) || (codeSent && !canConfirmCode) ? "not-allowed" : "pointer",
            fontSize: "15px",
            fontWeight: 600,
            opacity: loading || (!codeSent && !canSendCode) || (codeSent && !canConfirmCode) ? 0.5 : 1,
            transition: "opacity 0.15s ease, transform 0.15s ease",
            transform: "scale(1)",
          }}
          onMouseDown={(e) => {
            if (!(loading || (!codeSent && !canSendCode) || (codeSent && !canConfirmCode))) {
              (e.target as HTMLButtonElement).style.transform = "scale(0.98)";
            }
          }}
          onMouseUp={(e) => {
            (e.target as HTMLButtonElement).style.transform = "scale(1)";
          }}
        >
          {loading ? "Processando..." : codeSent ? "Confirmar codigo" : "Enviar codigo por SMS"}
        </button>

        {codeSent && (
          <button
            type="button"
            onClick={() => { setCodeSent(false); setError(null); }}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--aacp-muted)",
              cursor: "pointer",
              fontSize: "13px",
              padding: "8px 0",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
              transition: "color 0.15s ease",
            }}
          >
            Alterar numero
          </button>
        )}
      </form>
    </div>
  );
}

// ─── BuyerHubPanel ──────────────────────────────────────────────────────────

export function BuyerHubPanel({ isOpen, onClose, merchantId, onToggleTheme }: BuyerHubPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const vm = useBuyerHub();
  const [authVersion, setAuthVersion] = useState(0);

  // Focus trap: focus panel on open
  useEffect(() => {
    if (isOpen && panelRef.current) {
      panelRef.current.focus();
    }
  }, [isOpen]);

  // Escape key closes panel
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Trigger re-render after OTP login so vm picks up new auth
  const handleAuthSuccess = useCallback(() => {
    setAuthVersion((v) => v + 1);
    // Force page to re-evaluate — the useBuyerHub hook will pick up new token on next render cycle
    window.dispatchEvent(new StorageEvent("storage", { key: "zyon_buyer_token" }));
  }, []);

  if (!isOpen) return null;

  const isAuthenticated = Boolean(vm.auth);
  const displayName = vm.profile.data?.display_name ?? (vm.auth ? "Conta verificada" : "Comprador");
  const displayEmail = vm.profile.data?.email ?? vm.auth?.email ?? "nao autenticado";
  const avatarInitial = displayName[0]?.toUpperCase() ?? "U";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.5)",
          zIndex: 999,
          animation: "buyerHubFadeIn 0.2s ease",
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Hub do comprador"
        tabIndex={-1}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: "min(420px, 90vw)",
          height: "100dvh",
          background: "var(--aacp-panel-bg)",
          borderLeft: "1px solid var(--aacp-line)",
          boxShadow: "-12px 0 48px rgba(0, 0, 0, 0.24)",
          display: "flex",
          flexDirection: "column",
          zIndex: 1000,
          animation: "buyerHubSlideIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          outline: "none",
        }}
      >
        {/* Keyframes */}
        <style>{`
          @keyframes buyerHubSlideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes buyerHubFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            @keyframes buyerHubSlideIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          }
          [role="tablist"][aria-label="Navegacao do hub"]::-webkit-scrollbar { display: none; }
        `}</style>

        {/* Header — Premium spacing & typography */}
        <div style={{
          padding: "24px 20px",
          borderBottom: "1px solid var(--aacp-line)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1, minWidth: 0 }}>
            {/* Avatar with gradient ring */}
            <div
              style={{
                position: "relative",
                width: "48px",
                height: "48px",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              {/* Gradient ring (outer) */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, var(--aacp-accent) 0%, var(--aacp-accent, #3b82f6) 100%)",
                  opacity: 0.2,
                }}
              />
              {/* Avatar circle */}
              <div
                style={{
                  position: "absolute",
                  inset: 2,
                  borderRadius: "50%",
                  background: "var(--aacp-accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "18px",
                }}
              >
                {avatarInitial}
              </div>
            </div>

            {/* Name & email */}
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: "4px" }}>
              <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--aacp-fg)", wordBreak: "break-word" }}>{displayName}</span>
              <span style={{ fontSize: "12px", color: "var(--aacp-muted)", wordBreak: "break-word" }}>{displayEmail}</span>
            </div>
          </div>

          {/* Close button — ghost style */}
          <button
            onClick={onClose}
            aria-label="Fechar painel"
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              border: "none",
              background: "transparent",
              color: "var(--aacp-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 0.15s ease, color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--aacp-surface-2)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--aacp-fg)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--aacp-muted)";
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content area */}
        {!isAuthenticated ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column" }}>
            <PhoneLoginForm onAuthSuccess={handleAuthSuccess} />
          </div>
        ) : (
          <>
            {/* Tab bar — HORIZONTAL SCROLLABLE, NOT STRETCHED */}
            <div
              role="tablist"
              aria-label="Navegacao do hub"
              style={{
                display: "flex",
                gap: "0",
                borderBottom: "1px solid var(--aacp-line)",
                overflowX: "auto",
                overflowY: "hidden",
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              {TABS.map((tab) => {
                const isActive = vm.activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`buyerhub-tabpanel-${tab.key}`}
                    onClick={() => vm.setActiveTab(tab.key)}
                    title={tab.label}
                    style={{
                      flex: "0 0 auto",
                      width: "56px",
                      padding: "12px 0",
                      background: "transparent",
                      border: "none",
                      borderBottom: isActive ? "2px solid var(--aacp-accent)" : "2px solid transparent",
                      color: isActive ? "var(--aacp-accent)" : "var(--aacp-muted)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "4px",
                      transition: "color 0.15s ease, border-color 0.15s ease",
                    }}
                  >
                    {tab.icon}
                    <span style={{ fontSize: "10px", fontWeight: isActive ? 600 : 500, whiteSpace: "nowrap" }}>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab content — spacious padding, max-width constraint */}
            <div
              id={`buyerhub-tabpanel-${vm.activeTab}`}
              role="tabpanel"
              aria-label={TABS.find((t) => t.key === vm.activeTab)?.label}
              style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: "20px" }}
            >
              {vm.activeTab === "profile" && (
                <ProfileTab
                  profile={vm.profile.data}
                  addresses={vm.addresses.data ?? []}
                  loading={vm.profile.loading || vm.addresses.loading}
                  onUpdateProfile={vm.updateProfile}
                  onAddAddress={async (addr) => { await vm.createAddress(addr); }}
                  onUpdateAddress={async (id, addr) => { await vm.updateAddress(id, addr as any); }}
                  onDeleteAddress={vm.deleteAddress}
                />
              )}
              {vm.activeTab === "orders" && (
                <OrdersTab
                  purchases={vm.purchases.data ?? []}
                  hasMore={vm.purchasesHasMore}
                  loadingMore={vm.purchases.loading}
                  onLoadMore={vm.loadMorePurchases}
                />
              )}
              {vm.activeTab === "tracking" && (
                <TrackingTab
                  purchases={(vm.tracking.data ?? []).filter((p) => Boolean(p.tracking_code))}
                />
              )}
              {vm.activeTab === "conversations" && (
                <ConversationsTab
                  conversations={vm.conversations.data ?? []}
                  loading={vm.conversations.loading}
                  onRate={vm.rateMessage}
                />
              )}
              {vm.activeTab === "preferences" && (
                <PreferencesTab
                  preferences={vm.preferences.data}
                  intentProfile={vm.intentProfile.data ?? null}
                  loading={vm.preferences.loading}
                  onUpdatePreference={async (key, value) => {
                    await vm.updatePreferences({ [key]: value } as any);
                  }}
                />
              )}
              {vm.activeTab === "loyalty" && (
                <LoyaltyTab
                  loyalty={vm.loyalty.data}
                  summary={vm.summary.data ?? null}
                  loading={vm.loyalty.loading}
                />
              )}
              {vm.activeTab === "settings" && (
                <SettingsTab
                  theme={(typeof window !== "undefined" && (localStorage.getItem("zyon-theme") as "dark" | "light")) || "dark"}
                  onToggleTheme={() => {
                    // Delegate to the parent ConversationShell so its React theme
                    // state + applyTheme run (single source of truth). Fallback to a
                    // local write when the hub is used standalone.
                    if (onToggleTheme) {
                      onToggleTheme();
                    } else {
                      const current = (typeof window !== "undefined" && localStorage.getItem("zyon-theme")) ?? "dark";
                      localStorage.setItem("zyon-theme", current === "dark" ? "light" : "dark");
                    }
                    setAuthVersion((v) => v + 1);
                  }}
                  onExportData={vm.exportData}
                  onDeleteAccount={async () => { await vm.deleteAccount(); }}
                  onLogout={vm.signOut}
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default BuyerHubPanel;
