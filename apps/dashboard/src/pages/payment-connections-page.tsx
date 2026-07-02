import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  PlugZap,
  RefreshCw,
  Settings,
  Zap,
} from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type PaymentConnection,
  type MerchantProfile,
} from "../api-client.js";

// ── Exported types ───────────────────────────────────────────────────────────

export type Operation =
  | "idle"
  | "loading"
  | "connecting-stripe"
  | "connecting-asaas"
  | "syncing-stripe"
  | "syncing-asaas";

export type Provider = "stripe" | "asaas" | "crypto";

// ── Exported helpers ─────────────────────────────────────────────────────────

export function sanitizeError(e: unknown): string {
  if (e instanceof DashboardHttpError) {
    const { status } = e;
    if (status === 401) return "Sessão expirada. Faça login novamente.";
    if (status === 403) return "Sem permissão para esta ação.";
    if (status === 409) return "Já existe uma conexão ativa. Remova a atual primeiro.";
    if (status === 422) return "Não foi possível conectar. Verifique suas credenciais.";
    if (status >= 500) return "Erro interno. Tente novamente em alguns minutos.";
    return "Ocorreu um erro inesperado. Tente novamente.";
  }
  if (e instanceof TypeError) return "Sem conexão com o servidor.";
  return "Ocorreu um erro inesperado. Tente novamente.";
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function statusBadge(status: string) {
  if (status === "active")
    return (
      <span className="badge ok" role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-ok)", flexShrink: 0 }} />
        Conectado
      </span>
    );
  if (status === "pending")
    return (
      <span className="badge warn" role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-warn)", flexShrink: 0 }} />
        Pendente
      </span>
    );
  if (status === "error")
    return (
      <span className="badge bad" role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-bad)", flexShrink: 0 }} />
        Erro de conexão
      </span>
    );
  return (
    <span className="badge muted" role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-muted)", flexShrink: 0 }} />
      Desconectado
    </span>
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function statusAccentClass(status: string): string {
  if (status === "active") return "payment-status-accent--active";
  if (status === "pending") return "payment-status-accent--pending";
  return "payment-status-accent--error";
}

// ── GatewayCard ──────────────────────────────────────────────────────────────

interface GatewayCardProps {
  provider: Provider;
  name: string;
  description: string;
  iconBg: string;
  icon: React.ReactNode;
  connection: PaymentConnection | undefined;
  operation: Operation;
  connectingOperation: Operation;
  syncingOperation: Operation;
  onConnect: () => void;
  onSync: () => void;
  comingSoon?: boolean;
  configureUrl?: string;
}

function GatewayCard({
  provider,
  name,
  description,
  iconBg,
  icon,
  connection,
  operation,
  connectingOperation,
  syncingOperation,
  onConnect,
  onSync,
  comingSoon,
  configureUrl,
}: GatewayCardProps) {
  const isConnected = !!connection;
  const status = connection?.status ?? "disconnected";
  const isMyConnecting = operation === connectingOperation;
  const isMySyncing = operation === syncingOperation;
  const disabled = operation !== "idle" || comingSoon;

  return (
    <section
      className={`panel stacked ${isConnected ? statusAccentClass(status) : ""}`}
      aria-labelledby={`gateway-${provider}`}
    >
      <div className="panel-title">
        <div className="panel-title-group">
          <div className="provider-icon" style={{ background: iconBg }}>
            {icon}
          </div>
          <div>
            <h3 id={`gateway-${provider}`}>{name}</h3>
            <p className="text-muted text-sm">{description}</p>
          </div>
        </div>
        <div>
          {comingSoon ? (
            <span className="badge muted" role="status" aria-live="polite">Em breve</span>
          ) : (
            statusBadge(status)
          )}
        </div>
      </div>

      {isConnected && connection ? (
        <div className="panel" style={{ padding: "var(--space-5)", borderTop: "1px solid var(--color-border)" }}>
          {connection.account_id ? (
            <div className="detail-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 'var(--space-1)' }}>Conta</span>
              <code className="mono text-sm">{connection.account_id}</code>
            </div>
          ) : null}
          <div className="detail-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 'var(--space-1)' }}>Última sincronização</span>
            <span className="mono text-sm">{formatDate(connection.updated_at)}</span>
          </div>
        </div>
      ) : !comingSoon ? (
        <div className="empty-state">
          <PlugZap size={18} aria-hidden="true" />
          <p>Não conectado</p>
        </div>
      ) : (
        <div className="empty-state">
          <Settings size={18} aria-hidden="true" />
          <p>Disponível em breve</p>
        </div>
      )}

      <div className="button-row panel-footer">
        {comingSoon && !configureUrl ? null : comingSoon && configureUrl ? (
          <a
            href={configureUrl}
            className="btn-primary"
            aria-label={`Configurar ${name}`}
          >
            <Settings size={14} aria-hidden="true" />
            Configurar
          </a>
        ) : isConnected ? (
          <button
            type="button"
            disabled={!!disabled}
            onClick={onSync}
            aria-busy={isMySyncing}
            aria-label={`Sincronizar ${name}`}
          >
            <RefreshCw size={14} aria-hidden="true" className={isMySyncing ? "spin" : undefined} />
            {isMySyncing ? "Sincronizando..." : "Sincronizar"}
          </button>
        ) : (
          <button
            type="button"
            className="primary-action"
            disabled={!!disabled}
            onClick={onConnect}
            aria-busy={isMyConnecting}
            aria-label={`Conectar ${name}`}
          >
            <ExternalLink size={14} aria-hidden="true" />
            {isMyConnecting ? "Conectando..." : "Conectar provedor"}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function ConnectionSkeleton() {
  return (
    <div className="payment-grid" role="status" aria-label="Carregando conexões de pagamento">
      <div className="skeleton panel skeleton-card" />
      <div className="skeleton panel skeleton-card" />
      <div className="skeleton panel skeleton-card" />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function PaymentConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [connections, setConnections] = useState<PaymentConnection[]>([]);
  const [operation, setOperation] = useState<Operation>("idle");
  const [alert, setAlert] = useState<{ message: string; kind: "success" | "error" | "info" } | null>(null);

  useEffect(() => {
    if (!props.me) {
      setConnections([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setOperation("loading");
    setAlert(null);
    try {
      setConnections(await api.getPaymentConnections());
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function onboardStripe() {
    setOperation("connecting-stripe");
    setAlert(null);
    try {
      const { url } = await api.createStripeOnboardingLink({
        return_url: window.location.href,
        refresh_url: window.location.href,
      });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function syncStripe() {
    setOperation("syncing-stripe");
    setAlert(null);
    try {
      const updated = await api.syncStripeConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      setAlert({ message: "Provedor conectado com sucesso", kind: "success" });
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function onboardAsaas() {
    setOperation("connecting-asaas");
    setAlert(null);
    try {
      const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.href });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function syncAsaas() {
    setOperation("syncing-asaas");
    setAlert(null);
    try {
      const updated = await api.syncAsaasConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      setAlert({ message: "Conexão verificada", kind: "success" });
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  // ── Unauthenticated state ─────────────────────────────────────────────────

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Conexões de pagamento</h1>
            <p className="page-lead">Faça login para gerenciar suas conexões de pagamento.</p>
          </div>
        </header>
        <div className="panel stacked">
          <div className="empty-state">
            <div className="empty-state-icon"><CreditCard size={22} aria-hidden="true" /></div>
            <h3>Login necessário</h3>
            <p>Faça login para gerenciar suas conexões de pagamento.</p>
          </div>
        </div>
      </div>
    );
  }

  const stripeConn = connections.find((c) => c.provider === "stripe");
  const asaasConn = connections.find((c) => c.provider === "asaas");
  const cryptoConn = connections.find((c) => c.provider === "crypto");
  const otherConns = connections.filter(
    (c) => c.provider !== "stripe" && c.provider !== "asaas" && c.provider !== "crypto",
  );
  const activeCount = connections.filter((c) => c.status === "active").length;
  const isLoading = operation === "loading";

  return (
    <div className="dashboard-content">
      {/* ── Page Head ── */}
      <header className="page-head">
        <div>
          <span className="eyebrow"><CreditCard size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: "middle" }} />Conta</span>
          <h1>Conexões de pagamento</h1>
          <p className="page-lead">
            Conecte provedores de pagamento para processar vendas diretamente no checkout.
          </p>
        </div>
        <div className="button-row">
          <button
            type="button"
            disabled={operation !== "idle"}
            onClick={() => void load()}
            aria-label="Atualizar conexões"
          >
            <RefreshCw size={14} aria-hidden="true" className={isLoading ? "spin" : undefined} />
            Atualizar
          </button>
        </div>
      </header>

      {/* ── Alert ── */}
      {alert ? (
        <div
          role="alert"
          aria-live="assertive"
          className={`panel ${alert.kind === "error" ? "panel-error" : "panel-info"}`}
        >
          {alert.kind === "error" ? (
            <AlertCircle size={15} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={15} aria-hidden="true" />
          )}
          <span>{alert.message}</span>
        </div>
      ) : null}

      {/* ── Loading ── */}
      {isLoading ? <ConnectionSkeleton /> : null}

      {/* ── Gateway cards ── */}
      {!isLoading ? (
        <div className="payment-grid">
          <GatewayCard
            provider="stripe"
            name="Stripe"
            description="Cartão e pagamentos internacionais"
            iconBg="#635BFF"
            icon={<Zap size={18} color="#fff" aria-hidden="true" />}
            connection={stripeConn}
            operation={operation}
            connectingOperation="connecting-stripe"
            syncingOperation="syncing-stripe"
            onConnect={() => void onboardStripe()}
            onSync={() => void syncStripe()}
          />
          <GatewayCard
            provider="asaas"
            name="Asaas"
            description="PIX, boleto e cartão Brasil"
            iconBg="var(--color-brand)"
            icon={<CreditCard size={18} color="#fff" aria-hidden="true" />}
            connection={asaasConn}
            operation={operation}
            connectingOperation="connecting-asaas"
            syncingOperation="syncing-asaas"
            onConnect={() => void onboardAsaas()}
            onSync={() => void syncAsaas()}
          />
          <GatewayCard
            provider="crypto"
            name="Crypto (USDC)"
            description="Pagamentos em USDC via Polygon e Base"
            iconBg="#627EEA"
            icon={<Zap size={18} color="#fff" aria-hidden="true" />}
            connection={cryptoConn}
            operation={operation}
            connectingOperation="idle"
            syncingOperation="idle"
            onConnect={() => {}}
            onSync={() => {}}
            comingSoon={!cryptoConn}
            configureUrl={cryptoConn ? "/checkout-settings" : undefined}
          />
        </div>
      ) : null}

      {/* ── Other connections table ── */}
      {!isLoading && otherConns.length > 0 ? (
        <section className="panel stacked">
          <div className="panel-title">
            <div className="panel-title-group">
              <div className="provider-icon provider-icon--muted">
                <PlugZap size={15} aria-hidden="true" />
              </div>
              <h2>Provedores conectados</h2>
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
                    <td>{conn.provider}</td>
                    <td>{statusBadge(conn.status)}</td>
                    <td>
                      <code className="mono text-sm">{conn.account_id ?? "—"}</code>
                    </td>
                    <td className="mono text-sm">{formatDate(conn.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* ── Summary strip ── */}
      {!isLoading && connections.length > 0 ? (
        <div
          className={`panel ${activeCount === connections.length ? "panel-success" : "panel-warning"}`}
          role="status"
          aria-live="polite"
        >
          {activeCount === connections.length ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : (
            <AlertCircle size={16} aria-hidden="true" />
          )}
          <span>
            {activeCount} de {connections.length}{" "}
            {connections.length === 1 ? "conexão" : "conexões"}{" "}
            {activeCount === 1 ? "ativa" : "ativas"}
            {activeCount === connections.length
              ? ` e pronta${activeCount === 1 ? "" : "s"} para transações.`
              : ". Verifique as conexões pendentes."}
          </span>
        </div>
      ) : null}

      {/* ── Empty state ── */}
      {!isLoading && connections.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-state-icon">
              <PlugZap size={22} aria-hidden="true" />
            </div>
            <h3>Nenhum provedor conectado</h3>
            <p>
              Nenhum provedor conectado. Adicione um provedor de pagamento para aceitar cobranças no checkout.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
