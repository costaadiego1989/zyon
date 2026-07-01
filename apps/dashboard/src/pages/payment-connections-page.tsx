import React, { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  PlugZap,
  CreditCard,
  ArrowRight,
} from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type PaymentConnection,
  type MerchantProfile,
} from "../api-client.js";

function readError(e: unknown): string {
  return e instanceof DashboardHttpError
    ? e.responseBody.slice(0, 240) || `HTTP ${e.status}`
    : e instanceof Error
      ? e.message
      : String(e);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────

function statusDotClass(status: string): string {
  if (status === "active") return "green";
  if (status === "pending") return "amber";
  return "red";
}

function statusBadge(status: string) {
  if (status === "active")
    return <span className="badge ok">Ativo</span>;
  if (status === "pending")
    return <span className="badge warn">Pendente</span>;
  return <span className="badge bad">{status}</span>;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ConnectionSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-4)",
        }}
      >
        <div className="skeleton" style={{ height: 220, borderRadius: "var(--radius-md)" }} />
        <div className="skeleton" style={{ height: 220, borderRadius: "var(--radius-md)" }} />
      </div>
    </div>
  );
}

// ── Gateway card ──────────────────────────────────────────────────────────────

interface GatewayCardProps {
  name: string;
  description: string;
  iconBg: string;
  icon: React.ReactNode;
  connection: PaymentConnection | undefined;
  busy: boolean;
  onConnect: () => void;
  onSync: () => void;
}

function GatewayCard({
  name,
  description,
  iconBg,
  icon,
  connection,
  busy,
  onConnect,
  onSync,
}: GatewayCardProps) {
  const isConnected = !!connection;
  const status = connection?.status ?? "disconnected";

  return (
    <section className="panel stacked">
      {/* Header */}
      <div className="panel-title">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-sm)",
              background: iconBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 1px 4px rgba(0,0,0,0.14)",
            }}
          >
            {icon}
          </div>
          <div>
            <h2 style={{ marginBottom: 2 }}>{name}</h2>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
              {description}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {isConnected ? (
            <span className={`status-dot ${statusDotClass(status)}`} aria-hidden="true" />
          ) : null}
          {isConnected ? statusBadge(status) : <span className="badge muted">Não conectado</span>}
        </div>
      </div>

      {/* Body */}
      {isConnected && connection ? (
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-surface-raised)",
            display: "grid",
            gap: "var(--space-2)",
          }}
        >
          {connection.account_id ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                Conta
              </span>
              <code
                style={{
                  fontFamily: "var(--font-data)",
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 200,
                }}
              >
                {connection.account_id}
              </code>
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-3)",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--color-text-muted)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              Atualizado
            </span>
            <span
              style={{
                fontFamily: "var(--font-data)",
                fontSize: 12,
                color: "var(--color-text-secondary)",
              }}
            >
              {formatDate(connection.updated_at)}
            </span>
          </div>
        </div>
      ) : (
        <div
          className="empty-state"
          style={{ padding: "var(--space-5) var(--space-4)" }}
        >
          <div className="empty-state-icon">
            <PlugZap size={20} />
          </div>
          <p style={{ maxWidth: 240 }}>
            Nenhuma conta {name} conectada. Conecte para processar transações.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="button-row">
        <button
          type="button"
          className={!isConnected ? "primary-action" : ""}
          disabled={busy}
          onClick={onConnect}
          style={!isConnected ? { flex: 1, justifyContent: "center" } : undefined}
        >
          <ExternalLink size={14} />
          {isConnected ? `Reconectar ${name}` : `Conectar ${name}`}
          {!isConnected ? <ArrowRight size={14} style={{ marginLeft: "auto" }} /> : null}
        </button>
        {isConnected ? (
          <button type="button" disabled={busy} onClick={onSync}>
            <RefreshCw size={14} />
            Sincronizar
          </button>
        ) : null}
      </div>
    </section>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PaymentConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [connections, setConnections] = useState<PaymentConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" | "info" } | null>(null);

  useEffect(() => {
    if (!props.me) {
      setConnections([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      setConnections(await api.getPaymentConnections());
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function onboardStripe() {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api.createStripeOnboardingLink({
        return_url: window.location.href,
        refresh_url: window.location.href,
      });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function syncStripe() {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.syncStripeConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      setMessage({ text: "Stripe sincronizado.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function onboardAsaas() {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.href });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function syncAsaas() {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.syncAsaasConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      setMessage({ text: "Asaas sincronizado.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Conexões de pagamento</h1>
            <p className="page-lead">Login necessário para gerenciar contas de recebimento.</p>
          </div>
        </header>
      </div>
    );
  }

  const stripeConn = connections.find((c) => c.provider === "stripe");
  const asaasConn = connections.find((c) => c.provider === "asaas");
  const otherConns = connections.filter((c) => c.provider !== "stripe" && c.provider !== "asaas");
  const activeCount = connections.filter((c) => c.status === "active").length;

  return (
    <div className="dashboard-content">
      {/* ── Page Head ── */}
      <header className="page-head">
        <div>
          <h1>Conexões de pagamento</h1>
          <p className="page-lead">
            Conecte contas de recebimento para processar transações no checkout.
            {connections.length > 0 ? (
              <>
                {" "}·{" "}
                <span
                  className={`badge ${activeCount === connections.length ? "ok" : activeCount > 0 ? "warn" : "bad"}`}
                >
                  {activeCount}/{connections.length} ativas
                </span>
              </>
            ) : null}
          </p>
        </div>
        <button type="button" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={14} />
          Atualizar
        </button>
      </header>

      {/* ── Message ── */}
      {message ? (
        <div
          className={`panel ${message.kind === "error" ? "panel-error" : "panel-info"}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            marginBottom: "var(--space-4)",
          }}
        >
          {message.kind === "error" ? (
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          ) : (
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
          )}
          {message.text}
        </div>
      ) : null}

      {/* ── Loading ── */}
      {loading ? <ConnectionSkeleton /> : null}

      {/* ── Gateway cards ── */}
      {!loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <div className="ops-grid">
            <GatewayCard
              name="Stripe"
              description="Cartão e pagamentos internacionais"
              iconBg="#635BFF"
              icon={<Zap size={18} color="#fff" />}
              connection={stripeConn}
              busy={busy}
              onConnect={() => void onboardStripe()}
              onSync={() => void syncStripe()}
            />
            <GatewayCard
              name="Asaas"
              description="PIX, boleto e cartão Brasil"
              iconBg="var(--color-brand)"
              icon={<CreditCard size={18} color="#fff" />}
              connection={asaasConn}
              busy={busy}
              onConnect={() => void onboardAsaas()}
              onSync={() => void syncAsaas()}
            />
          </div>

          {/* ── Other connections ── */}
          {otherConns.length > 0 ? (
            <section className="panel stacked">
              <div className="panel-title">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-brand-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-brand)",
                      flexShrink: 0,
                    }}
                  >
                    <PlugZap size={15} />
                  </div>
                  <h2>Outras conexões</h2>
                </div>
                <span className="badge muted">{otherConns.length}</span>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Provedor</th>
                      <th>Status</th>
                      <th>Conta</th>
                      <th>Criado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherConns.map((conn) => (
                      <tr key={conn.id}>
                        <td style={{ fontWeight: 600 }}>{conn.provider}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                            <span
                              className={`status-dot ${statusDotClass(conn.status)}`}
                              aria-hidden="true"
                            />
                            {statusBadge(conn.status)}
                          </div>
                        </td>
                        <td>
                          <code style={{ fontFamily: "var(--font-data)", fontSize: 12 }}>
                            {conn.account_id ?? "—"}
                          </code>
                        </td>
                        <td style={{ fontFamily: "var(--font-data)", fontSize: 12 }}>
                          {formatDate(conn.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* ── Summary strip ── */}
          {connections.length > 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "var(--space-3) var(--space-4)",
                border: `1px solid ${activeCount === connections.length ? "var(--color-success-border)" : "var(--color-warning-border)"}`,
                borderRadius: "var(--radius-sm)",
                background: activeCount === connections.length ? "var(--color-success-bg)" : "var(--color-warning-bg)",
              }}
            >
              {activeCount === connections.length ? (
                <CheckCircle2
                  size={16}
                  style={{ color: "var(--color-success)", flexShrink: 0 }}
                />
              ) : (
                <AlertCircle
                  size={16}
                  style={{ color: "var(--color-warning)", flexShrink: 0 }}
                />
              )}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: activeCount === connections.length
                    ? "var(--color-success)"
                    : "var(--color-warning)",
                }}
              >
                {activeCount} de {connections.length} conexão{connections.length !== 1 ? "ões" : ""}{" "}
                {activeCount === connections.length ? "ativa e pronta para transações." : "ativa. Verifique as conexões pendentes."}
              </span>
            </div>
          ) : null}

          {/* ── Empty state — no connections at all ── */}
          {connections.length === 0 && !loading ? (
            <div className="panel">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <PlugZap size={22} />
                </div>
                <h3>Nenhuma conexão configurada</h3>
                <p>
                  Conecte pelo menos um gateway de pagamento para que o widget
                  possa processar transações no checkout.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
