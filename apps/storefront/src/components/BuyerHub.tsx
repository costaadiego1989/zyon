"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getValidBuyer } from "@/lib/buyer-auth";

type BuyerProfile = {
  global_user_id: string;
  display_name: string;
  email: string;
  phone?: string;
  address?: {
    zip?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };
};

type TrackingEvent = {
  status: string;
  description: string;
  location?: string;
  occurred_at: string;
};

type BuyerPurchase = {
  id: string;
  order_id?: string;
  merchant_name: string;
  tracking_code?: string;
  tracking_status?: string;
  carrier?: string;
  tracking_events?: TrackingEvent[];
  total: number;
  items_count: number;
  items?: Array<{ name: string; quantity: number; unit_price: number }>;
  currency: string;
  created_at: string;
  discount_amount?: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
const AUTH_STORAGE_KEY = "aacp_buyer_auth_session";

type AuthSession = {
  global_user_id: string;
  email: string;
  access_token: string;
  expires_at: number;
  phone: string;
};

function safeReadSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  // 1) Native hub session (set by hub OTP login).
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as AuthSession;
      if (s.global_user_id && s.access_token && !(s.expires_at && Date.now() >= s.expires_at)) {
        return s;
      }
    }
  } catch {
    /* fall through */
  }
  // 2) Shared checkout session (set by BuyerAuthGate / login / register).
  // Keeps hub and checkout auth in sync — logging in on one recognizes the other.
  const buyer = getValidBuyer();
  if (buyer) {
    let expiresAt = 0;
    try {
      const payload = JSON.parse(atob(buyer.token.split(".")[1]));
      if (payload.exp) expiresAt = payload.exp * 1000;
    } catch {}
    return {
      global_user_id: buyer.globalUserId,
      email: buyer.email ?? "",
      access_token: buyer.token,
      expires_at: expiresAt,
      phone: "",
    };
  }
  return null;
}

const TRACKING_STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando rastreio",
  label_generated: "Etiqueta gerada",
  dispatched: "Despachado",
  in_transit: "Em transporte",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  returned: "Devolvido",
  cancelled: "Cancelado",
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

function trackingStatusLabel(status?: string | null): string {
  if (!status) return "Pendente";
  return TRACKING_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

function correiosTrackingUrl(code: string): string {
  return `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(code)}`;
}

function formatPhone(value: string): string {
  const numbers = value.replace(/\D/g, "").slice(0, 11);
  if (numbers.length > 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
  if (numbers.length > 2) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  return numbers;
}

type TabType = "profile" | "orders" | "tracking" | "settings" | "personalization";

export function BuyerHub({ merchantId, isOpen, onClose }: { merchantId?: string; isOpen: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabType>("profile");
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [purchases, setPurchases] = useState<BuyerPurchase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [session, setSession] = useState<AuthSession | null>(() => safeReadSession());
  const panelRef = useRef<HTMLDivElement>(null);

  const isAuth = Boolean(session);

  // ─── Auth state ────────────────────────────────────────────────────────────
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [phoneCode, setPhoneCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Restore theme from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pulse-theme-pref") as "dark" | "light" | null;
      if (saved) setTheme(saved);
    } catch {
      /* SSR/privacy */
    }
  }, []);

  // Re-sync session from storage each time the hub opens, so a checkout-side
  // login (or logout) is reflected without a page reload.
  useEffect(() => {
    if (!isOpen) return;
    const fresh = safeReadSession();
    setSession((prev) => {
      if (fresh?.access_token === prev?.access_token) return prev;
      return fresh;
    });
  }, [isOpen]);

  // Fetch profile and purchases if authenticated
  useEffect(() => {
    if (!session || !merchantId || !isOpen) return;
    loadData();
  }, [session, merchantId, isOpen]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  async function loadData() {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${session.access_token}`,
      };
      const [profileRes, purchasesRes] = await Promise.all([
        fetch(`${API_BASE}/buyer/me/profile`, { headers }).catch(() => null),
        fetch(`${API_BASE}/buyer/me/purchases?limit=10`, { headers }).catch(() => null),
      ]);

      if (profileRes?.ok) {
        const p = (await profileRes.json()) as BuyerProfile;
        setProfile(p);
      } else {
        setProfile(null);
      }

      if (purchasesRes?.ok) {
        const data = (await purchasesRes.json()) as { purchases: BuyerPurchase[] };
        setPurchases(data.purchases || []);
      } else {
        setPurchases([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }

  // ─── Phone OTP auth ─────────────────────────────────────────────────────────

  const handlePhoneChange = useCallback((value: string) => {
    setPhone(formatPhone(value));
  }, []);

  async function handleSendCode() {
    const normalizedPhone = phone.replace(/\D/g, "");
    if (normalizedPhone.length < 10) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/buyer/phone/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const reason = payload?.message ?? "Falha ao enviar codigo.";
        setAuthError(reason);
        return;
      }
      setCodeSent(true);
    } catch {
      setAuthError("Erro de rede ao enviar codigo.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleVerifyCode() {
    const normalizedPhone = phone.replace(/\D/g, "");
    if (phoneCode.length !== 6) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/buyer/phone/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, code: phoneCode }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const reason = payload?.message ?? "Codigo invalido.";
        setAuthError(reason);
        return;
      }
      // Persist session
      const globalUserId = payload.globalUserId ?? payload.global_user_id;
      const accessToken = payload.accessToken ?? payload.access_token;
      const email = payload.email ?? "";
      const expiresIn = payload.expiresIn ?? payload.expires_in ?? 3600;
      if (!globalUserId || !accessToken) {
        setAuthError("Resposta invalida do servidor.");
        return;
      }
      const newSession: AuthSession = {
        global_user_id: globalUserId,
        email,
        access_token: accessToken,
        expires_at: Date.now() + (expiresIn - 60) * 1000,
        phone: normalizedPhone,
      };
      setSession(newSession);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newSession));
      // Sync shared checkout session so the OTP gate is skipped after a hub login.
      try {
        localStorage.setItem("zyon_buyer_token", accessToken);
        localStorage.setItem("zyon_buyer_session", JSON.stringify({ globalUserId, token: accessToken, email }));
      } catch {}
      setCodeSent(false);
      setPhoneCode("");
    } catch {
      setAuthError("Erro de rede ao verificar codigo.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    setSession(null);
    setProfile(null);
    setPurchases([]);
    setPhone("");
    setPhoneCode("");
    setCodeSent(false);
    setAuthError(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    // Clear shared checkout session too, so logout is global across hub + checkout.
    try {
      localStorage.removeItem("zyon_buyer_token");
      localStorage.removeItem("zyon_buyer_session");
    } catch {}
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("pulse-theme-pref", next);
    } catch {
      /* */
    }
  }

  if (!isOpen) return null;

  const canSendCode = phone.replace(/\D/g, "").length >= 10;
  const canConfirmCode = codeSent && phoneCode.length === 6;

  return (
    <>
      <div className="aacp-buyer-hub-backdrop" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.5)", zIndex: 999 }} />
      <div
        ref={panelRef}
        className="aacp-buyer-hub"
        role="dialog"
        aria-modal="true"
        aria-label="Hub do comprador"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: "100%",
          maxWidth: "380px",
          height: "100vh",
          background: "var(--aacp-panel-bg)",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.3)",
          display: "flex",
          flexDirection: "column",
          zIndex: 1000,
          animation: "slideInRight 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Styles */}
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          .aacp-buyer-hub-backdrop {
            animation: fadeIn 0.2s ease;
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .aacp-auth-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
          }
          .aacp-auth-field > span {
            font-size: 12px;
            font-weight: 600;
            color: var(--aacp-muted);
          }
          .aacp-auth-input-wrap {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            border-radius: 10px;
            border: 1px solid var(--aacp-line);
            background: var(--aacp-surface-3);
            transition: border-color 0.15s ease;
          }
          .aacp-auth-input-wrap:focus-within {
            border-color: var(--aacp-accent);
          }
          .aacp-auth-input-wrap svg {
            color: var(--aacp-muted);
            flex-shrink: 0;
          }
          .aacp-auth-input-wrap input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: var(--aacp-fg);
            font-size: 14px;
            font-family: inherit;
          }
          .aacp-auth-input-wrap input::placeholder {
            color: var(--aacp-muted);
            opacity: 0.7;
          }
          .aacp-auth-primary {
            width: 100%;
            padding: 12px;
            border-radius: 10px;
            background: var(--aacp-accent);
            color: #fff;
            border: none;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: opacity 0.15s ease;
          }
          .aacp-auth-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .aacp-auth-secondary {
            background: transparent;
            border: none;
            color: var(--aacp-muted);
            cursor: pointer;
            font-size: 12px;
            padding: 6px 0;
            text-decoration: underline;
            text-underline-offset: 2px;
          }
          .aacp-auth-error {
            font-size: 12px;
            color: #ef4444;
            text-align: center;
            padding: 4px 0;
          }
          .aacp-auth-status {
            font-size: 12px;
            color: var(--aacp-muted);
            text-align: center;
          }
          .aacp-auth-assurance {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: 8px;
            background: var(--aacp-surface-2);
            border: 1px solid var(--aacp-line);
            font-size: 12px;
            color: var(--aacp-muted);
          }
          .aacp-auth-assurance svg {
            color: var(--aacp-success, #22c55e);
            flex-shrink: 0;
          }
        `}</style>

        {/* Header */}
        <div style={{ padding: "16px", borderBottom: "1px solid var(--aacp-line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "var(--aacp-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 700,
                fontSize: "14px",
              }}
            >
              {profile?.display_name?.[0]?.toUpperCase() ?? (session ? "V" : "U")}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)" }}>{profile?.display_name ?? (session ? "Conta verificada" : "Comprador")}</span>
              <span style={{ fontSize: "11px", color: "var(--aacp-muted)" }}>{profile?.email ?? session?.email ?? "nao autenticado"}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              border: "1px solid var(--aacp-line)",
              background: "transparent",
              color: "var(--aacp-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Fechar painel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {isAuth && (
          <div style={{ display: "flex", borderBottom: "1px solid var(--aacp-line)", background: "var(--aacp-bg)" }}>
            {(["profile", "orders", "tracking", "personalization", "settings"] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: "12px 8px",
                  background: "transparent",
                  borderBottom: activeTab === tab ? "2px solid var(--aacp-accent)" : "2px solid transparent",
                  color: activeTab === tab ? "var(--aacp-fg)" : "var(--aacp-muted)",
                  fontSize: "12px",
                  fontWeight: activeTab === tab ? 600 : 500,
                  cursor: "pointer",
                  border: "none",
                  textTransform: "capitalize",
                }}
              >
                {tab === "profile" && "Perfil"}
                {tab === "orders" && "Pedidos"}
                {tab === "tracking" && "Rastreamento"}
                {tab === "personalization" && "Preferências"}
                {tab === "settings" && "Config"}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column" }}>
          {!isAuth ? (
            <PhoneLoginForm
              phone={phone}
              onPhoneChange={handlePhoneChange}
              phoneCode={phoneCode}
              onPhoneCodeChange={setPhoneCode}
              codeSent={codeSent}
              canSendCode={canSendCode}
              canConfirmCode={canConfirmCode}
              loading={authLoading}
              error={authError}
              onSendCode={handleSendCode}
              onVerifyCode={handleVerifyCode}
              onBack={() => { setCodeSent(false); setAuthError(null); }}
            />
          ) : loading && !profile ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "var(--aacp-muted)", fontSize: "13px", padding: "48px 0" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                <circle cx="12" cy="12" r="10" />
              </svg>
              Carregando...
            </div>
          ) : error && !profile ? (
            <div style={{ color: "#ef4444", fontSize: "13px", textAlign: "center" }}>
              <div style={{ marginBottom: "8px" }}>⚠️ {error}</div>
              <button
                onClick={() => loadData()}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  background: "var(--aacp-accent)",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                Tentar novamente
              </button>
            </div>
          ) : activeTab === "profile" ? (
            <ProfileTab profile={profile} />
          ) : activeTab === "orders" ? (
            <OrdersTab purchases={purchases} />
          ) : activeTab === "tracking" ? (
            <TrackingTab purchases={purchases} />
          ) : activeTab === "personalization" ? (
            <PersonalizationTab />
          ) : activeTab === "settings" ? (
            <SettingsTab theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout} />
          ) : null}
        </div>
      </div>
    </>
  );
}

// ─── Phone Login Form (matches widget GlobalAuthModal pattern) ─────────────────

function PhoneLoginForm({
  phone,
  onPhoneChange,
  phoneCode,
  onPhoneCodeChange,
  codeSent,
  canSendCode,
  canConfirmCode,
  loading,
  error,
  onSendCode,
  onVerifyCode,
  onBack,
}: {
  phone: string;
  onPhoneChange: (v: string) => void;
  phoneCode: string;
  onPhoneCodeChange: (v: string) => void;
  codeSent: boolean;
  canSendCode: boolean;
  canConfirmCode: boolean;
  loading: boolean;
  error: string | null;
  onSendCode: () => void;
  onVerifyCode: () => void;
  onBack: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "24px 0" }}>
      {/* Icon */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: "var(--aacp-surface-2)",
          border: "1px solid var(--aacp-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--aacp-muted)", marginBottom: "6px" }}>Conta segura</div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--aacp-fg)", marginBottom: "6px" }}>Entrar com celular</div>
        <div style={{ fontSize: "12px", color: "var(--aacp-muted)", lineHeight: 1.5 }}>Acesse pedidos anteriores e conclua compras futuras com menos etapas.</div>
      </div>

      {/* Assurance strip */}
      <div className="aacp-auth-assurance">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span>Seu acesso e seus dados permanecem protegidos.</span>
      </div>

      {/* Form */}
      <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {!codeSent ? (
          <label className="aacp-auth-field">
            <span>Celular</span>
            <div className="aacp-auth-input-wrap">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
              <input
                value={phone}
                onChange={(e) => onPhoneChange(e.target.value)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(11) 99999-9999"
                aria-label="Numero do celular"
              />
            </div>
          </label>
        ) : (
          <label className="aacp-auth-field">
            <span>Codigo de verificacao</span>
            <div className="aacp-auth-input-wrap">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              <input
                value={phoneCode}
                onChange={(e) => onPhoneCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                aria-label="Codigo de verificacao"
                style={{ letterSpacing: "3px", textAlign: "center" }}
              />
            </div>
          </label>
        )}

        {codeSent && (
          <p className="aacp-auth-status" role="status">
            Codigo enviado para {phone}
          </p>
        )}

        {error && (
          <p className="aacp-auth-error" role="alert">{error}</p>
        )}

        <button
          type="button"
          className="aacp-auth-primary"
          disabled={loading || (!codeSent && !canSendCode) || (codeSent && !canConfirmCode)}
          onClick={() => { codeSent ? onVerifyCode() : onSendCode(); }}
        >
          {loading ? "Processando..." : codeSent ? "Confirmar codigo" : "Enviar codigo por SMS"}
        </button>

        {codeSent && (
          <button type="button" className="aacp-auth-secondary" onClick={onBack}>
            Alterar numero
          </button>
        )}
      </form>
    </div>
  );
}

function ProfileTab({ profile }: { profile: BuyerProfile | null }) {
  if (!profile) return <div style={{ color: "var(--aacp-muted)", fontSize: "13px" }}>Dados não disponíveis.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase" }}>Nome</div>
        <div style={{ fontSize: "13px", color: "var(--aacp-fg)", marginTop: "4px" }}>{profile.display_name}</div>
      </div>
      <div>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase" }}>Email</div>
        <div style={{ fontSize: "13px", color: "var(--aacp-fg)", marginTop: "4px" }}>{profile.email}</div>
      </div>
      {profile.phone && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase" }}>Telefone</div>
          <div style={{ fontSize: "13px", color: "var(--aacp-fg)", marginTop: "4px" }}>{profile.phone}</div>
        </div>
      )}
      {profile.address && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase", marginBottom: "4px" }}>Endereço</div>
          <div style={{ fontSize: "13px", color: "var(--aacp-fg)", lineHeight: 1.6 }}>
            {profile.address.street} {profile.address.number}
            {profile.address.complement && `, ${profile.address.complement}`}
            <br />
            {profile.address.neighborhood} {profile.address.city}, {profile.address.state}
            <br />
            {profile.address.zip}
          </div>
        </div>
      )}
      <div style={{ fontSize: "11px", color: "var(--aacp-muted)", marginTop: "8px" }}>ID: {profile.global_user_id}</div>
    </div>
  );
}

function OrdersTab({ purchases }: { purchases: BuyerPurchase[] }) {
  if (purchases.length === 0) {
    return (
      <div style={{ textAlign: "center", color: "var(--aacp-muted)", fontSize: "13px", padding: "24px 0" }}>
        📦 Nenhum pedido ainda.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {purchases.map((p) => (
        <div
          key={p.id}
          style={{
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-surface-2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)" }}>{p.merchant_name}</div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--aacp-fg)" }}>{fmtBRL(p.total)}</div>
          </div>
          <div style={{ fontSize: "11px", color: "var(--aacp-muted)" }}>
            {p.items_count} {p.items_count === 1 ? "item" : "itens"} · {fmtDate(p.created_at)}
          </div>
          {p.tracking_code && (
            <div style={{ fontSize: "11px", color: "var(--aacp-muted)", marginTop: "6px" }}>
              📍 {p.tracking_code} · {trackingStatusLabel(p.tracking_status)}
            </div>
          )}
          {p.tracking_code && (
            <a
              href={correiosTrackingUrl(p.tracking_code)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                marginTop: "6px",
                fontSize: "11px",
                color: "var(--aacp-accent)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Rastrear →
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function TrackingTab({ purchases }: { purchases: BuyerPurchase[] }) {
  const active = purchases.filter((p) => p.tracking_status && p.tracking_status !== "delivered" && p.tracking_status !== "cancelled");

  if (active.length === 0) {
    return (
      <div style={{ textAlign: "center", color: "var(--aacp-muted)", fontSize: "13px", padding: "24px 0" }}>
        📭 Nenhuma entrega em andamento.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {active.map((p) => (
        <div
          key={p.id}
          style={{
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-surface-2)",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--aacp-fg)", marginBottom: "8px" }}>{p.merchant_name}</div>
          <div style={{ fontSize: "11px", color: "var(--aacp-success)", fontWeight: 600, marginBottom: "6px" }}>
            {trackingStatusLabel(p.tracking_status)}
          </div>
          {p.tracking_events && p.tracking_events.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
              {p.tracking_events.slice(-2).map((evt, idx) => (
                <div key={idx} style={{ color: "var(--aacp-muted)" }}>
                  <strong style={{ color: "var(--aacp-fg)" }}>{trackingStatusLabel(evt.status)}</strong>
                  <br />
                  {fmtDate(evt.occurred_at)} {evt.location && `- ${evt.location}`}
                </div>
              ))}
            </div>
          )}
          {p.tracking_code && (
            <a
              href={correiosTrackingUrl(p.tracking_code)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                marginTop: "6px",
                fontSize: "10px",
                color: "var(--aacp-accent)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Ver detalhes →
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function PersonalizationTab() {
  const [intentData, setIntentData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = safeReadSession();
    if (!session) {
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/buyer/consent/intent-memory`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIntentData(data))
      .catch(() => setIntentData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ fontSize: "13px", color: "var(--aacp-muted)", padding: "24px 0", textAlign: "center" }}>Carregando...</div>;
  }

  if (!intentData || !intentData.has_consent) {
    return (
      <div style={{ fontSize: "13px", color: "var(--aacp-muted)", padding: "24px 0", textAlign: "center" }}>
        <p>Nenhuma preferência ativa.</p>
        <p style={{ fontSize: "11px", marginTop: "8px" }}>Aceite a personalização no checkout para ver recomendações personalizadas.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase" }}>Perfil detectado</div>
        <div style={{ fontSize: "13px", color: "var(--aacp-fg)", marginTop: "4px" }}>{intentData.primary_intent ?? "Geral"}</div>
      </div>
      {intentData.category_focus && intentData.category_focus.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase", marginBottom: "4px" }}>Categorias</div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {intentData.category_focus.map((cat: string) => (
              <span
                key={cat}
                style={{
                  padding: "3px 8px",
                  borderRadius: "4px",
                  background: "color-mix(in srgb, var(--aacp-accent) 15%, transparent)",
                  color: "var(--aacp-accent)",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}
      {intentData.budget_tier && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase" }}>Faixa de orçamento</div>
          <div style={{ fontSize: "13px", color: "var(--aacp-fg)", marginTop: "4px", textTransform: "capitalize" }}>{intentData.budget_tier}</div>
        </div>
      )}
      <div style={{ marginTop: "12px", padding: "10px 14px", borderRadius: "8px", background: "var(--aacp-surface-2)", border: "1px solid var(--aacp-line)", fontSize: "11px", color: "var(--aacp-muted)" }}>
        Essas preferências ajudam a personalizar sugestões de produtos. Para apagar seus dados, acesse <a href="/privacidade" style={{ color: "var(--aacp-accent)", textDecoration: "none", fontWeight: 600 }}>Privacidade</a>.
      </div>
    </div>
  );
}

function SettingsTab({ theme, onToggleTheme, onLogout }: { theme: "dark" | "light"; onToggleTheme: () => void; onLogout: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase", marginBottom: "8px" }}>Aparência</div>
        <button
          onClick={onToggleTheme}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-card)",
            color: "var(--aacp-fg)",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {theme === "dark" ? "☀️ Modo claro" : "🌙 Modo escuro"}
        </button>
      </div>

      <div style={{ paddingTop: "16px", borderTop: "1px solid var(--aacp-line)" }}>
        <button
          onClick={onLogout}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid #ef4444",
            background: "transparent",
            color: "#ef4444",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          🚪 Sair da conta
        </button>
      </div>
    </div>
  );
}
