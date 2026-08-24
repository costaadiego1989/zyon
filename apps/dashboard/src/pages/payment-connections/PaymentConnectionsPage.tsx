import React from "react";
import { AlertCircle, CheckCircle2, CreditCard, ExternalLink, PlugZap, RefreshCw, Settings, Zap, ArrowRight } from "lucide-react";
import type { PaymentConnection } from "../../api-client.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { GatewayCard } from "./components/GatewayCard.js";
import { WalletSection } from "./components/WalletSection.js";
import { usePaymentConnectionsPage, formatDate, type Operation, type CryptoWalletState, type AsaasState } from "./usePaymentConnectionsPage.js";
import type { MerchantProfile } from "../../api-client.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import "./payment-connections-page.css";

interface PaymentConnectionsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const USDC_TOKEN_BY_CHAIN_NETWORK = {
  "polygon:mainnet": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  "polygon:testnet": "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  "base:mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base:testnet": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

function ConnectionSkeleton() {
  return (
    <div role="status" aria-label="Carregando conexões de pagamento" className="connection-skeleton">
      {[0, 1, 2].map((i) => (
        <div key={i} className="connection-skeleton__item" />
      ))}
    </div>
  );
}

export function PaymentConnectionsPage({ me }: PaymentConnectionsPageProps) {
  const {
    connections,
    operation,
    alert,
    asaas,
    crypto,
    setAlert,
    setAsaas,
    setCrypto,
    load,
    onboardStripe,
    syncStripe,
    onboardAsaas,
    saveAsaasConfig,
    syncAsaas,
    onboardMercadoPago,
    syncMercadoPago,
    saveCryptoWallet,
  } = usePaymentConnectionsPage(me);

  // ── Unauthenticated state ─────────────────────────────────────────────────

  if (!me) {
    return (
      <div className="payment-connections-page__login-required">
        <div className="payment-connections-page__title-group">
          <span className="eyebrow">Pagamentos</span>
          <h1>Conexões de pagamento</h1>
          <p className="page-lead">Faça login para gerenciar suas conexões de pagamento</p>
        </div>
        <div className="payment-connections-page__login-card">
          <CreditCard size={22} aria-hidden="true" />
          <h3 className="payment-connections-page__login-title">Login necessário</h3>
          <p className="payment-connections-page__login-text">Faça login para gerenciar suas conexões de pagamento.</p>
        </div>
      </div>
    );
  }

  // ── Authenticated state ───────────────────────────────────────────────────

  const isLoading = operation === "loading";
  const stripeConn = connections.find((c) => c.provider === "stripe");
  const asaasConn = connections.find((c) => c.provider === "asaas");
  const mercadopagoConn = connections.find((c) => c.provider === "mercadopago");
  const otherConns = connections.filter(
    (c) => c.provider !== "stripe" && c.provider !== "asaas" && c.provider !== "crypto" && c.provider !== "mercadopago",
  );
  const tokenAddress = USDC_TOKEN_BY_CHAIN_NETWORK[`${crypto.config.chain}:${crypto.config.network}`];
  const activeCount = connections.filter((c) => c.status === "active").length + (crypto.config.enabled ? 1 : 0);

  return (
    <div className="payment-connections-page">
      {/* Header */}
      <div className="payment-connections-page__header">
        <div className="payment-connections-page__title-group">
          <span className="eyebrow">Pagamentos</span>
          <h1>Conexões de pagamento</h1>
          <p className="page-lead">
            Configure gateways e carteiras para receber pagamentos
          </p>
        </div>
        <button
          type="button"
          className="payment-connections-page__refresh-btn"
          disabled={operation !== "idle"}
          onClick={() => void load()}
          aria-label="Atualizar conexões"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {/* Alert */}
      {alert ? (
        <div className={`alert alert--${alert.kind}`}>
          {alert.kind === "error" ? (
            <AlertCircle size={15} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={15} aria-hidden="true" />
          )}
          <span>{alert.message}</span>
        </div>
      ) : null}

      {/* Loading */}
      {isLoading ? <ConnectionSkeleton /> : null}

      {/* Gateway Cards Grid */}
      {!isLoading ? (
        <SectionErrorBoundary sectionName="Gateways de Pagamento">
        <div className="payment-connections-page__grid">
          <GatewayCard
            provider="stripe"
            name="Stripe"
            description="Cartão internacional"
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
            provider="mercadopago"
            name="Mercado Pago"
            description="PIX, cartão e boleto — América Latina"
            iconBg="#009EE3"
            icon={<CreditCard size={18} color="#fff" aria-hidden="true" />}
            connection={mercadopagoConn}
            operation={operation}
            connectingOperation="connecting-mercadopago"
            syncingOperation="syncing-mercadopago"
            onConnect={() => void onboardMercadoPago()}
            onSync={() => void syncMercadoPago()}
          />
          <WalletSection
            crypto={crypto}
            setCrypto={setCrypto}
            tokenAddress={tokenAddress}
            saveCryptoWallet={saveCryptoWallet}
          />
        </div>
        </SectionErrorBoundary>
      ) : null}

      {/* Asaas Config Card — only show when NOT connected */}
      {!isLoading && !asaasConn ? (
        <div className="asaas-config">
          <div className="asaas-config__header">
            <div className="asaas-config__title-group">
              <h3 className="asaas-config__title">Conectar Asaas</h3>
              <p className="asaas-config__subtitle">Insira sua API Key para ativar PIX, boleto e cartão.</p>
            </div>
          </div>
          <div className="asaas-config__grid">
            <div className="asaas-config__form-group">
              <label className="asaas-config__label">API Key</label>
              <input
                type="password"
                value={asaas.apiKey}
                onChange={(e) => setAsaas({ ...asaas, apiKey: e.target.value })}
                placeholder="$aact_..."
                className="asaas-config__input"
              />
            </div>
            <div className="asaas-config__form-group">
              <label className="asaas-config__label">Webhook Token</label>
              <input
                type="password"
                value={asaas.webhookToken}
                onChange={(e) => setAsaas({ ...asaas, webhookToken: e.target.value })}
                placeholder="token do webhook"
                className="asaas-config__input"
              />
            </div>
            <label className="asaas-config__checkbox">
              <input
                type="checkbox"
                checked={asaas.sandbox}
                onChange={(e) => setAsaas({ ...asaas, sandbox: e.target.checked })}
              />
              Sandbox
            </label>
            <button
              type="button"
              disabled={!asaas.apiKey.trim() || asaas.saving}
              onClick={() => void saveAsaasConfig()}
              className="asaas-config__button"
            >
              {asaas.saving ? "Conectando..." : "Conectar"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Other Providers Table */}
      {!isLoading && otherConns.length > 0 ? (
        <section className="other-providers">
          <div className="other-providers__header">
            <div className="other-providers__title-group">
              <div className="other-providers__icon">
                <PlugZap size={15} aria-hidden="true" />
              </div>
              <h2 className="other-providers__title">Provedores conectados</h2>
            </div>
            <span className="other-providers__badge">{otherConns.length}</span>
          </div>
          <div className="other-providers__table-wrapper">
            <table className="other-providers__table">
              <thead>
                <tr>
                  {["Provedor", "Status", "Conta", "Criado"].map((h) => (
                    <th key={h} className="other-providers__table-header">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {otherConns.map((conn) => (
                  <tr key={conn.id}>
                    <td className="other-providers__table-cell">{conn.provider}</td>
                    <td className="other-providers__table-cell">
                      <StatusBadge status={conn.status} />
                    </td>
                    <td className="other-providers__table-cell">
                      <code className="other-providers__table-code">{conn.account_id ?? "—"}</code>
                    </td>
                    <td className="other-providers__table-cell other-providers__table-date">
                      {formatDate(conn.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Stats */}
      {!isLoading && connections.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className={`payment-connections-page__stats ${
            activeCount === connections.length
              ? "payment-connections-page__stats--success"
              : "payment-connections-page__stats--warning"
          }`}
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

      {/* Empty State */}
      {!isLoading && connections.length === 0 ? (
        <div className="payment-connections-page__empty">
          <PlugZap size={22} aria-hidden="true" />
          <h3 className="payment-connections-page__empty-title">Nenhum provedor conectado</h3>
          <p className="payment-connections-page__empty-text">
            Adicione um provedor de pagamento para aceitar cobranças no checkout.
          </p>
        </div>
      ) : null}
    </div>
  );
}
