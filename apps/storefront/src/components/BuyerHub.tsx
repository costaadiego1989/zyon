"use client";

import { useState, useEffect, useRef } from "react";

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

type TabType = "profile" | "orders" | "tracking" | "settings";

export function BuyerHub({ merchantId, isOpen, onClose }: { merchantId?: string; isOpen: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabType>("profile");
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [purchases, setPurchases] = useState<BuyerPurchase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isAuth, setIsAuth] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Restore theme from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pulse-theme-pref") as "dark" | "light" | null;
      if (saved) setTheme(saved);
    } catch {
      /* SSR/privacy */
    }
  }, []);

  // Fetch profile and purchases if authenticated
  useEffect(() => {
    if (!isAuth || !merchantId || !isOpen) return;
    loadData();
  }, [isAuth, merchantId, isOpen]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [profileRes, purchasesRes] = await Promise.all([
        fetch(`${API_BASE}/buyer/me/profile`, { headers: { "Accept": "application/json" } }).catch(() => null),
        fetch(`${API_BASE}/buyer/me/purchases?limit=10`, { headers: { "Accept": "application/json" } }).catch(() => null),
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

  async function handleSendOtp() {
    if (!email.trim()) return;
    setOtpLoading(true);
    try {
      // Mock: in production, this calls a real OTP endpoint
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar OTP");
    } finally {
      setOtpLoading(false);
    }
  }

  function handleVerifyOtp() {
    // Mock verification — in production, verify against backend
    if (otp.length >= 4) {
      setIsAuth(true);
      setOtpSent(false);
      setOtp("");
    }
  }

  function handleLogout() {
    setIsAuth(false);
    setProfile(null);
    setPurchases([]);
    setEmail("");
    setOtp("");
    setOtpSent(false);
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
              {profile?.display_name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)" }}>{profile?.display_name ?? "Comprador"}</span>
              <span style={{ fontSize: "11px", color: "var(--aacp-muted)" }}>{profile?.email ?? "não autenticado"}</span>
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
            {(["profile", "orders", "tracking", "settings"] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: "12px 8px",
                  background: activeTab === tab ? "transparent" : "transparent",
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
                {tab === "settings" && "Config"}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column" }}>
          {!isAuth ? (
            <LoginForm email={email} setEmail={setEmail} otp={otp} setOtp={setOtp} otpSent={otpSent} otpLoading={otpLoading} onSendOtp={handleSendOtp} onVerify={handleVerifyOtp} />
          ) : loading && !profile ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "var(--aacp-muted)", fontSize: "13px" }}>
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
          ) : activeTab === "settings" ? (
            <SettingsTab theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout} />
          ) : null}
        </div>
      </div>
    </>
  );
}

function LoginForm({
  email,
  setEmail,
  otp,
  setOtp,
  otpSent,
  otpLoading,
  onSendOtp,
  onVerify,
}: {
  email: string;
  setEmail: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  otpSent: boolean;
  otpLoading: boolean;
  onSendOtp: () => void;
  onVerify: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", justifyContent: "center", padding: "24px 0" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--aacp-fg)", marginBottom: "4px" }}>Acesso à conta</div>
        <div style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>Entre para acessar seus pedidos e configurações</div>
      </div>

      {!otpSent ? (
        <>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid var(--aacp-line)",
              background: "var(--aacp-surface-3)",
              color: "var(--aacp-fg)",
              fontSize: "13px",
            }}
          />
          <button
            onClick={onSendOtp}
            disabled={!email.trim() || otpLoading}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              background: "var(--aacp-accent)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              opacity: !email.trim() || otpLoading ? 0.5 : 1,
            }}
          >
            {otpLoading ? "Enviando..." : "Enviar código"}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: "12px", color: "var(--aacp-muted)", textAlign: "center" }}>
            Código enviado para <strong>{email}</strong>
          </div>
          <input
            type="text"
            value={otp}
            onChange={(e) => setOtp(e.target.value.slice(0, 6))}
            placeholder="000000"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid var(--aacp-line)",
              background: "var(--aacp-surface-3)",
              color: "var(--aacp-fg)",
              fontSize: "13px",
              textAlign: "center",
              letterSpacing: "4px",
            }}
          />
          <button
            onClick={onVerify}
            disabled={otp.length < 4}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              background: "var(--aacp-accent)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              opacity: otp.length < 4 ? 0.5 : 1,
            }}
          >
            Confirmar
          </button>
          <button
            onClick={() => setEmail("")}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--aacp-muted)",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            Voltar
          </button>
        </>
      )}
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
