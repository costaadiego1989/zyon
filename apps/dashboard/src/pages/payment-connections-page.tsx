import React, { useEffect, useState } from "react";
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
  DashboardHttpError,
  type PaymentConnection,
  type MerchantProfile,
} from "../api-client.js";
import { useApi } from "../hooks/useApi.js";

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

const BADGE_FONT = "600 11px var(--mono)";

const USDC_TOKEN_BY_CHAIN_NETWORK = {
  "polygon:mainnet": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  "polygon:testnet": "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  "base:mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base:testnet": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

export function statusBadge(status: string) {
  if (status === "active") {
    return (
      <span role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: BADGE_FONT, background: "var(--good-soft)", color: "var(--good)", border: "1px solid var(--good)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--good)", flexShrink: 0 }} />
        Conectado
      </span>
    );
  }
  if (status === "pending" || status === "restricted") {
    return (
      <span role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: BADGE_FONT, background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid var(--warn)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--warn)", flexShrink: 0 }} />
        {status === "restricted" ? "Restrito" : "Pendente"}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: BADGE_FONT, background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid var(--danger)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", flexShrink: 0 }} />
        Erro de conexão
      </span>
    );
  }
  return (
    <span role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: BADGE_FONT, background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid var(--danger)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", flexShrink: 0 }} />
      Desconectado
    </span>
  );
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
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 20, display: "flex", flexDirection: "column", gap: 16 }}
      aria-labelledby={`gateway-${provider}`}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: iconBg }}>
            {icon}
          </div>
          <div>
            <h3 id={`gateway-${provider}`} style={{ font: "600 14px var(--mono)", color: "var(--ink)", margin: 0 }}>{name}</h3>
            <p style={{ font: "12px var(--sans)", color: "var(--muted)", margin: "4px 0 0 0" }}>{description}</p>
          </div>
        </div>
        <div>
          {comingSoon ? (
            <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, font: BADGE_FONT, background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)" }}>Em breve</span>
          ) : (
            statusBadge(status)
          )}
        </div>
      </div>

      {isConnected && connection ? (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {connection.account_id ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Conta</span>
              <code style={{ font: "12px var(--mono)", color: "var(--ink)" }}>{connection.account_id}</code>
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Última sincronização</span>
            <span style={{ font: "12px var(--mono)", color: "var(--ink)" }}>{formatDate(connection.updated_at)}</span>
          </div>
        </div>
      ) : !comingSoon ? (
        <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--muted)" }}>
          <PlugZap size={18} aria-hidden="true" />
          <p style={{ margin: 0, font: "13px var(--sans)" }}>Não conectado</p>
        </div>
      ) : (
        <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--muted)" }}>
          <Settings size={18} aria-hidden="true" />
          <p style={{ margin: 0, font: "13px var(--sans)" }}>Disponível em breve</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: "auto" }}>
        {comingSoon && !configureUrl ? null : comingSoon && configureUrl ? (
          <a
            href={configureUrl}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", font: "600 13px var(--mono)", textDecoration: "none" }}
            aria-label={`Configurar ${name}`}
          >
            <Settings size={14} aria-hidden="true" />
            Configurar
          </a>
        ) : isConnected ? (
          <button
            type="button"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", font: "600 13px var(--mono)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}
            disabled={!!disabled}
            onClick={onSync}
            aria-busy={isMySyncing}
            aria-label={`Sincronizar ${name}`}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {isMySyncing ? "Sincronizando..." : "Sincronizar"}
          </button>
        ) : (
          <button
            type="button"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(180deg, var(--accent), var(--accent-dark))", color: "var(--bg)", font: "600 13px var(--mono)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}
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
    <div role="status" aria-label="Carregando conexões de pagamento" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, height: 200, opacity: 0.5 }} />
      ))}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function PaymentConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useApi();
  const [connections, setConnections] = useState<PaymentConnection[]>([]);
  const [operation, setOperation] = useState<Operation>("idle");
  const [alert, setAlert] = useState<{ message: string; kind: "success" | "error" | "info" } | null>(null);
  const [asaasApiKey, setAsaasApiKey] = useState("");
  const [asaasWebhookToken, setAsaasWebhookToken] = useState("");
  const [asaasSandbox, setAsaasSandbox] = useState(true);
  const [asaasSaving, setAsaasSaving] = useState(false);
  const [cryptoEnabled, setCryptoEnabled] = useState(false);
  const [cryptoChain, setCryptoChain] = useState<"polygon" | "base">("polygon");
  const [cryptoNetwork, setCryptoNetwork] = useState<"testnet" | "mainnet">("testnet");
  const [cryptoWallet, setCryptoWallet] = useState("");
  const [cryptoSaving, setCryptoSaving] = useState(false);
  const [cryptoSaved, setCryptoSaved] = useState(false);

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
      const [paymentConnections, rules] = await Promise.all([
        api.getPaymentConnections(),
        api.getMerchantRules(),
      ]);
      setConnections(paymentConnections);
      const crypto = rules.cryptoPayments;
      if (crypto) {
        setCryptoEnabled(crypto.enabled === true);
        setCryptoChain(crypto.chain === "base" ? "base" : "polygon");
        setCryptoNetwork(crypto.network === "mainnet" ? "mainnet" : "testnet");
        setCryptoWallet(crypto.treasuryAddress ?? "");
      }
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

  async function saveAsaasConfig() {
    setAsaasSaving(true);
    setAlert(null);
    try {
      const updated = await api.connectAsaas({
        api_key: asaasApiKey.trim(),
        webhook_token: asaasWebhookToken.trim(),
        sandbox: asaasSandbox,
      });
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.provider === "asaas");
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      setAlert({ message: "Asaas configurado com sucesso", kind: "success" });
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setAsaasSaving(false);
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

  async function saveCryptoWallet() {
    setCryptoSaving(true);
    setCryptoSaved(false);
    try {
      await api.putMerchantRules({
        cryptoPayments: {
          enabled: cryptoEnabled,
          chain: cryptoChain,
          network: cryptoNetwork,
          treasuryAddress: cryptoWallet.trim(),
          token: "USDC",
          quoteTtlSeconds: 900,
          brlPerUsdc: 5.5,
        },
      });
      setCryptoSaved(true);
      setAlert({ message: "Configuração crypto salva com sucesso.", kind: "success" });
      setTimeout(() => setCryptoSaved(false), 4000);
    } catch (e) {
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setCryptoSaving(false);
    }
  }

  // ── Unauthenticated state ─────────────────────────────────────────────────

  if (!props.me) {
    return (
      <div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>PAGAMENTOS</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Conexões de pagamento</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Faça login para gerenciar suas conexões de pagamento.</div>
        </div>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--muted)" }}>
          <CreditCard size={22} aria-hidden="true" />
          <h3 style={{ font: "600 13px var(--mono)", color: "var(--ink)", margin: 0 }}>Login necessário</h3>
          <p style={{ margin: 0, font: "13px var(--sans)" }}>Faça login para gerenciar suas conexões de pagamento.</p>
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
  const tokenAddress = USDC_TOKEN_BY_CHAIN_NETWORK[`${cryptoChain}:${cryptoNetwork}`];
  const cryptoConfiguredConnection: PaymentConnection | undefined = cryptoEnabled
    ? {
        id: "crypto-rules",
        provider: "crypto",
        status: "active",
        account_id: `${cryptoChain}:${cryptoNetwork}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    : cryptoConn;
  const activeCount = connections.filter((c) => c.status === "active").length + (cryptoEnabled ? 1 : 0);
  const isLoading = operation === "loading";

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>PAGAMENTOS</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Conexões de pagamento</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Conecte provedores de pagamento para processar vendas diretamente no checkout.</div>
        </div>
        <button
          type="button"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", font: "600 13px var(--mono)", cursor: operation !== "idle" ? "not-allowed" : "pointer", opacity: operation !== "idle" ? 0.5 : 1 }}
          disabled={operation !== "idle"}
          onClick={() => void load()}
          aria-label="Atualizar conexões"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {alert ? (
        <div role="alert" aria-live="assertive" style={{ display: "flex", alignItems: "center", gap: 10, background: alert.kind === "error" ? "var(--danger-soft)" : "var(--accent-soft)", border: `1px solid ${alert.kind === "error" ? "var(--danger)" : "var(--accent-line)"}`, borderRadius: 14, padding: "14px 18px", marginBottom: 20, color: alert.kind === "error" ? "var(--danger)" : "var(--accent)", font: "13px var(--sans)" }}>
          {alert.kind === "error" ? (
            <AlertCircle size={15} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={15} aria-hidden="true" />
          )}
          <span>{alert.message}</span>
        </div>
      ) : null}

      {isLoading ? <ConnectionSkeleton /> : null}

      {!isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginBottom: 20 }}>
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
            iconBg="var(--accent)"
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
            connection={cryptoConfiguredConnection}
            operation={operation}
            connectingOperation="idle"
            syncingOperation="idle"
            onConnect={() => {}}
            onSync={() => {}}
          />
        </div>
      ) : null}

      {!isLoading ? (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
            <div>
              <h3 style={{ font: "600 13px var(--mono)", color: "var(--ink)", margin: 0 }}>Asaas</h3>
              <p style={{ font: "12px var(--sans)", color: "var(--muted)", margin: "4px 0 0 0" }}>Configure API Key, webhook token e ambiente.</p>
            </div>
            {statusBadge(asaasConn?.status ?? "disconnected")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px var(--mono)", letterSpacing: "0.03em", color: "var(--faint)" }}>API Key</label>
              <input type="password" value={asaasApiKey} onChange={(e) => setAsaasApiKey(e.target.value)} placeholder="$aact_..." style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--mono)", color: "var(--ink)", outline: "none" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px var(--mono)", letterSpacing: "0.03em", color: "var(--faint)" }}>Webhook Token</label>
              <input type="password" value={asaasWebhookToken} onChange={(e) => setAsaasWebhookToken(e.target.value)} placeholder="token do webhook" style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--mono)", color: "var(--ink)", outline: "none" }} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", font: "600 12px var(--mono)", color: "var(--ink)", cursor: "pointer" }}>
              <input type="checkbox" checked={asaasSandbox} onChange={(e) => setAsaasSandbox(e.target.checked)} />
              Sandbox
            </label>
            <button type="button" disabled={!asaasApiKey.trim() || asaasSaving} onClick={() => void saveAsaasConfig()} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(180deg, var(--accent), var(--accent-dark))", color: "var(--bg)", font: "600 13px var(--mono)", cursor: asaasApiKey.trim() && !asaasSaving ? "pointer" : "not-allowed", opacity: asaasApiKey.trim() && !asaasSaving ? 1 : 0.5 }}>
              {asaasSaving ? "Testando..." : "Testar conexão"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Crypto Wallet Configuration ── */}
      {!isLoading ? (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#627EEA20", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#627EEA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v12M6 12h12" /></svg>
            </div>
            <div>
              <h3 style={{ font: "600 13px var(--mono)", color: "var(--ink)", margin: 0 }}>Carteira Crypto</h3>
              <p style={{ font: "12px var(--sans)", color: "var(--muted)", margin: 0, marginTop: 2 }}>Receba pagamentos em USDC diretamente na sua wallet</p>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", font: "600 12px var(--mono)", color: "var(--ink)", cursor: "pointer" }}>
              <input type="checkbox" checked={cryptoEnabled} onChange={(e) => setCryptoEnabled(e.target.checked)} />
              Habilitar crypto
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px var(--mono)", letterSpacing: "0.03em", color: "var(--faint)" }}>Chain</label>
              <select
                value={cryptoChain}
                onChange={(e) => setCryptoChain(e.target.value === "base" ? "base" : "polygon")}
                style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--sans)", color: "var(--ink)", outline: "none" }}
              >
                <option value="polygon">Polygon</option>
                <option value="base">Base</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px var(--mono)", letterSpacing: "0.03em", color: "var(--faint)" }}>Network</label>
              <select
                value={cryptoNetwork}
                onChange={(e) => setCryptoNetwork(e.target.value === "mainnet" ? "mainnet" : "testnet")}
                style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--sans)", color: "var(--ink)", outline: "none" }}
              >
                <option value="testnet">Testnet</option>
                <option value="mainnet">Mainnet</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px var(--mono)", letterSpacing: "0.03em", color: "var(--faint)" }}>Treasury Address</label>
              <input
                type="text"
                value={cryptoWallet}
                onChange={(e) => setCryptoWallet(e.target.value)}
                placeholder="0x1234...abcd"
                style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--mono)", color: "var(--ink)", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px var(--mono)", letterSpacing: "0.03em", color: "var(--faint)" }}>Token</label>
              <input
                type="text"
                value={`USDC · ${tokenAddress}`}
                readOnly
                style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", font: "12px var(--mono)", color: "var(--ink)", outline: "none" }}
              />
            </div>
          </div>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              disabled={(cryptoEnabled && !cryptoWallet.trim()) || cryptoSaving}
              onClick={() => void saveCryptoWallet()}
              style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "linear-gradient(150deg, var(--accent), var(--accent-dark))", font: "600 12px var(--sans)", color: "white", cursor: (!cryptoEnabled || cryptoWallet.trim()) && !cryptoSaving ? "pointer" : "not-allowed", opacity: (!cryptoEnabled || cryptoWallet.trim()) && !cryptoSaving ? 1 : 0.5 }}
            >
              {cryptoSaving ? "Salvando..." : "Salvar wallet"}
            </button>
            {cryptoSaved ? <span style={{ font: "12px var(--sans)", color: "var(--good)" }}>✓ Wallet salva</span> : null}
          </div>
        </div>
      ) : null}

      {!isLoading && otherConns.length > 0 ? (
        <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
                <PlugZap size={15} aria-hidden="true" />
              </div>
              <h2 style={{ font: "600 13px var(--mono)", color: "var(--ink)", margin: 0 }}>Provedores conectados</h2>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, font: BADGE_FONT, background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)" }}>{otherConns.length}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--sans)", color: "var(--ink)" }}>
              <thead>
                <tr>
                  {["Provedor", "Status", "Conta", "Criado"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {otherConns.map((conn) => (
                  <tr key={conn.id}>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>{conn.provider}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>{statusBadge(conn.status)}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
                      <code style={{ font: "12px var(--mono)" }}>{conn.account_id ?? "—"}</code>
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", font: "12px var(--mono)" }}>{formatDate(conn.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!isLoading && connections.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          style={{ display: "flex", alignItems: "center", gap: 10, background: activeCount === connections.length ? "var(--good-soft)" : "var(--warn-soft)", border: `1px solid ${activeCount === connections.length ? "var(--good)" : "var(--warn)"}`, borderRadius: 14, padding: "14px 18px", marginBottom: 20, color: activeCount === connections.length ? "var(--good)" : "var(--warn)", font: "13px var(--sans)" }}
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

      {!isLoading && connections.length === 0 ? (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--muted)" }}>
          <PlugZap size={22} aria-hidden="true" />
          <h3 style={{ font: "600 13px var(--mono)", color: "var(--ink)", margin: 0 }}>Nenhum provedor conectado</h3>
          <p style={{ margin: 0, font: "13px var(--sans)", textAlign: "center" }}>
            Adicione um provedor de pagamento para aceitar cobranças no checkout.
          </p>
        </div>
      ) : null}
    </div>
  );
}
