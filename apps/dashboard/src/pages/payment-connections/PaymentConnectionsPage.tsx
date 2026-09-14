import React, { useState } from "react";
import { AlertCircle, CheckCircle2, CreditCard, FileText, PlugZap, QrCode, RefreshCw } from "lucide-react";
import type { PaymentConnection } from "../../api-client.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { GatewayCard } from "./components/GatewayCard.js";
import { WalletSection } from "./components/WalletSection.js";
import { StripeLogo, AsaasLogo, MercadoPagoLogo } from "./components/ProviderLogos.js";
import { usePaymentConnectionsPage, formatDate, type CryptoWalletState, type PaymentRoutingSettings } from "./usePaymentConnectionsPage.js";
import type { MerchantProfile } from "../../api-client.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { SidePanel } from "../../components/SidePanel.js";
import { AsaasConnectionForm } from "./components/AsaasConnectionForm.js";
import {
  gatewayConnectionCount,
  MAX_PAYMENT_GATEWAY_CONNECTIONS,
  providerConnectionLimitReached,
} from "./payment-provider-limit.js";
import "./payment-connections-page.css";

type DisconnectProvider = "stripe" | "asaas" | "mercadopago";
const PROVIDER_LABELS: Record<DisconnectProvider, string> = {
  stripe: "Stripe",
  asaas: "Asaas",
  mercadopago: "Mercado Pago",
};

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

function PaymentRoutingPanel({
  routing,
  saving,
  asaasActive,
  stripeActive,
  mercadoPagoActive,
  onChange,
}: {
  routing: PaymentRoutingSettings;
  saving: boolean;
  asaasActive: boolean;
  stripeActive: boolean;
  mercadoPagoActive: boolean;
  onChange: (next: PaymentRoutingSettings) => void;
}) {
  const selectedPix =
    routing.pix ??
    (mercadoPagoActive ? "mercadopago" : asaasActive ? "asaas" : "");
  const selectedCard =
    routing.card ??
    (stripeActive
      ? "stripe"
      : asaasActive
      ? "asaas"
      : mercadoPagoActive
      ? "mercadopago"
      : "");
  const noPix = !asaasActive && !mercadoPagoActive;
  const noCard = !asaasActive && !stripeActive && !mercadoPagoActive;
  const pixAvailable =
    selectedPix === "asaas"
      ? asaasActive
      : selectedPix === "mercadopago"
      ? mercadoPagoActive
      : false;
  const cardAvailable =
    selectedCard === "asaas"
      ? asaasActive
      : selectedCard === "stripe"
      ? stripeActive
      : selectedCard === "mercadopago"
      ? mercadoPagoActive
      : false;
  const availableCount = [pixAvailable, asaasActive, cardAvailable].filter(
    Boolean
  ).length;
  const providerName = (provider: string) =>
    ({ asaas: "Asaas", stripe: "Stripe", mercadopago: "Mercado Pago" }[
      provider
    ] ?? "Nenhum provedor");
  const update = (method: "pix" | "card", value: string) =>
    onChange({
      ...routing,
      [method]: value as PaymentRoutingSettings[typeof method],
    });
  const unavailableOption = (value: string, available: boolean) =>
    !available && value ? (
      <option value={value}>
        {providerName(value)} (conexão indisponível)
      </option>
    ) : null;

  return (
    <section
      className="payment-routing"
      aria-labelledby="payment-routing-title"
    >
      <header className="payment-routing__header">
        <div className="payment-routing__heading">
          <span className="payment-routing__eyebrow">Checkout</span>
          <h2 id="payment-routing-title">Roteamento de pagamentos</h2>
          <p>
            Defina o provedor de cada forma de pagamento. O checkout só exibe
            métodos com uma conexão disponível.
          </p>
        </div>
        <span
          className="payment-routing__readiness"
          aria-live="polite"
          data-saving={saving || undefined}
        >
          <CheckCircle2 size={15} aria-hidden="true" />
          {saving
            ? "Salvando alterações"
            : `${availableCount} de 3 métodos disponíveis`}
        </span>
      </header>

      <div
        className="payment-routing__methods"
        role="group"
        aria-label="Formas de pagamento do checkout"
      >
        <article
          className="payment-routing__method"
          data-available={pixAvailable}
        >
          <div className="payment-routing__method-identity">
            <span className="payment-routing__method-icon" aria-hidden="true">
              <QrCode size={18} />
            </span>
            <div>
              <div className="payment-routing__method-title-row">
                <h3>Pix</h3>
                <span className="payment-routing__availability">
                  {pixAvailable ? "Disponível" : "Indisponível"}
                </span>
              </div>
              <p>Pagamento instantâneo para o comprador.</p>
            </div>
          </div>
          <div className="payment-routing__control">
            <label htmlFor="payment-routing-pix">Processar com</label>
            <select
              id="payment-routing-pix"
              value={selectedPix}
              disabled={saving || noPix}
              aria-describedby="payment-routing-pix-status"
              onChange={(event) => update("pix", event.target.value)}
            >
              {unavailableOption(selectedPix, pixAvailable)}
              {noPix ? <option value="">Conecte um provedor</option> : null}
              {asaasActive && <option value="asaas">Asaas</option>}
              {mercadoPagoActive && (
                <option value="mercadopago">Mercado Pago</option>
              )}
            </select>
            <span id="payment-routing-pix-status">
              {pixAvailable
                ? `Conectado via ${providerName(selectedPix)}`
                : "Este método ficará oculto no checkout."}
            </span>
          </div>
        </article>

        <article
          className="payment-routing__method"
          data-available={asaasActive}
        >
          <div className="payment-routing__method-identity">
            <span className="payment-routing__method-icon" aria-hidden="true">
              <FileText size={18} />
            </span>
            <div>
              <div className="payment-routing__method-title-row">
                <h3>Boleto</h3>
                <span className="payment-routing__availability">
                  {asaasActive ? "Disponível" : "Indisponível"}
                </span>
              </div>
              <p>Cobrança bancária com vencimento.</p>
            </div>
          </div>
          <div className="payment-routing__control">
            <span className="payment-routing__control-label">
              Processar com
            </span>
            <div
              className="payment-routing__fixed-provider"
              data-available={asaasActive}
            >
              <strong>{asaasActive ? "Asaas" : "Conecte o Asaas"}</strong>
              <span>Único provedor compatível</span>
            </div>
          </div>
        </article>

        <article
          className="payment-routing__method"
          data-available={cardAvailable}
        >
          <div className="payment-routing__method-identity">
            <span className="payment-routing__method-icon" aria-hidden="true">
              <CreditCard size={18} />
            </span>
            <div>
              <div className="payment-routing__method-title-row">
                <h3>Cartão</h3>
                <span className="payment-routing__availability">
                  {cardAvailable ? "Disponível" : "Indisponível"}
                </span>
              </div>
              <p>Pagamento com cartão de crédito.</p>
            </div>
          </div>
          <div className="payment-routing__control">
            <label htmlFor="payment-routing-card">Processar com</label>
            <select
              id="payment-routing-card"
              value={selectedCard}
              disabled={saving || noCard}
              aria-describedby="payment-routing-card-status"
              onChange={(event) => update("card", event.target.value)}
            >
              {unavailableOption(selectedCard, cardAvailable)}
              {noCard ? <option value="">Conecte um provedor</option> : null}
              {stripeActive && <option value="stripe">Stripe</option>}
              {asaasActive && <option value="asaas">Asaas</option>}
              {mercadoPagoActive && (
                <option value="mercadopago">Mercado Pago</option>
              )}
            </select>
            <span id="payment-routing-card-status">
              {cardAvailable
                ? selectedCard === "mercadopago"
                  ? "Checkout Pro hospedado pelo Mercado Pago."
                  : selectedCard === "asaas"
                  ? "Cobrança hospedada pelo Asaas."
                  : "Cobrança processada pelo Stripe."
                : "Este método ficará oculto no checkout."}
            </span>
          </div>
        </article>
      </div>

      <footer className="payment-routing__policy">
        <span>Continuidade de pagamento</span>
        <div className="payment-routing__fallback">
          <div>
            <strong>Usar provedor alternativo</strong>
            <p>
              {routing.fallbackWhenUnavailable
                ? "Se o provedor prioritário não estiver apto antes da cobrança, o checkout usa a primeira alternativa ativa compatível. Uma cobrança já iniciada nunca é reenviada a outro gateway."
                : "Se o provedor prioritário não estiver apto antes da cobrança, a forma fica oculta no checkout até a conexão voltar."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            className="payment-routing__fallback-switch"
            aria-checked={routing.fallbackWhenUnavailable === true}
            aria-label="Usar provedor alternativo quando o prioritário estiver indisponível"
            disabled={saving}
            onClick={() => onChange({
              ...routing,
              fallbackWhenUnavailable: !routing.fallbackWhenUnavailable,
            })}
          >
            <span>{routing.fallbackWhenUnavailable ? "Ativo" : "Desativado"}</span>
            <i aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}

export function PaymentConnectionsPage({ me }: PaymentConnectionsPageProps) {
  const {
    connections,
    operation,
    alert,
    crypto,
    companyPrefill,
    paymentRouting,
    paymentRoutingSaving,
    setCrypto,
    load,
    onboardStripe,
    syncStripe,
    connectAsaasAccount,
    openAsaasOnboarding,
    approveAsaasSandbox,
    syncAsaas,
    onboardMercadoPago,
    syncMercadoPago,
    disconnect,
    saveCryptoWallet,
    savePaymentRouting,
  } = usePaymentConnectionsPage(me);

  const [pendingDisconnect, setPendingDisconnect] = useState<DisconnectProvider | null>(null);
  const [asaasFormOpen, setAsaasFormOpen] = useState(false);
  const asaasSaving = operation === "connecting-asaas";

  if (!me) {
    return (
      <div className="page-container payment-connections-page__login-required">
        <header className="page-head">
          <div>
            <span className="eyebrow">Loja</span>
            <h1>Conexões de pagamento</h1>
            <p className="page-lead">Faça login para gerenciar suas conexões de pagamento</p>
          </div>
        </header>
        <div className="payment-connections-page__login-card">
          <CreditCard size={22} aria-hidden="true" />
          <h3 className="payment-connections-page__login-title">Login necessário</h3>
          <p className="payment-connections-page__login-text">Faça login para gerenciar suas conexões de pagamento.</p>
        </div>
      </div>
    );
  }

  const isLoading = operation === "loading";
  const stripeConn = connections.find((c) => c.provider === "stripe");
  const asaasConn = connections.find((c) => c.provider === "asaas");
  const mercadopagoConn = connections.find((c) => c.provider === "mercadopago");
  const otherConns = connections.filter(
    (c) => c.provider !== "stripe" && c.provider !== "asaas" && c.provider !== "crypto" && c.provider !== "mercadopago",
  );
  const tokenAddress = USDC_TOKEN_BY_CHAIN_NETWORK[`${crypto.config.chain}:${crypto.config.network}`];
  const connectedGatewayCount = gatewayConnectionCount(connections);
  const activeCount = connections.filter((c) => c.status === "active").length;
  const supportsCheckoutMethod = (connection: PaymentConnection | undefined, method: "pix" | "boleto" | "card") =>
    Boolean(connection?.checkout_methods?.includes(method));

  return (
    <div className="page-container payment-connections-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Conexões de pagamento</h1>
          <p className="page-lead">Configure gateways e carteiras para receber pagamentos. Cada loja pode manter até {MAX_PAYMENT_GATEWAY_CONNECTIONS} gateways conectados.</p>
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
      </header>

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
            iconBg="#fff"
            icon={<StripeLogo size={52} />}
            connection={stripeConn}
            operation={operation}
            connectingOperation="connecting-stripe"
            syncingOperation="syncing-stripe"
            onConnect={() => void onboardStripe()}
            onSync={() => void syncStripe()}
            onDisconnect={() => setPendingDisconnect("stripe")}
            onOnboard={stripeConn && stripeConn.status !== "active" ? () => void onboardStripe() : undefined}
            connectionLimitReached={providerConnectionLimitReached(connections, "stripe")}
          />
          <GatewayCard
            provider="asaas"
            name="Asaas"
            description="Pix, boleto e cartão hospedado"
            iconBg="#fff"
            icon={<AsaasLogo size={52} />}
            connection={asaasConn}
            operation={operation}
            connectingOperation="connecting-asaas"
            syncingOperation="syncing-asaas"
            onConnect={() => setAsaasFormOpen(true)}
            onSync={() => void syncAsaas()}
            onDisconnect={() => setPendingDisconnect("asaas")}
            onOnboard={asaasConn && asaasConn.status !== "active" ? () => void openAsaasOnboarding() : undefined}
            connectionLimitReached={providerConnectionLimitReached(connections, "asaas")}
            devAction={
              import.meta.env.DEV && asaasConn && asaasConn.status !== "active"
                ? { label: "Aprovar (sandbox)", onClick: () => void approveAsaasSandbox() }
                : undefined
            }
          />
          <GatewayCard
            provider="mercadopago"
            name="Mercado Pago"
            description="Pix e cartão via OAuth"
            iconBg="#fff"
            icon={<MercadoPagoLogo size={52} />}
            connection={mercadopagoConn}
            operation={operation}
            connectingOperation="connecting-mercadopago"
            syncingOperation="syncing-mercadopago"
            onConnect={() => void onboardMercadoPago()}
            onSync={() => void syncMercadoPago()}
            onDisconnect={() => setPendingDisconnect("mercadopago")}
            connectionLimitReached={providerConnectionLimitReached(connections, "mercadopago")}
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

      {!isLoading ? (
        <PaymentRoutingPanel
          routing={paymentRouting}
          saving={paymentRoutingSaving}
          asaasActive={supportsCheckoutMethod(asaasConn, "pix")}
          stripeActive={supportsCheckoutMethod(stripeConn, "card")}
          mercadoPagoActive={supportsCheckoutMethod(mercadopagoConn, "pix")}
          onChange={(next) => void savePaymentRouting(next)}
        />
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
      {!isLoading && connectedGatewayCount > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className={`payment-connections-page__stats ${
            activeCount === connectedGatewayCount
              ? "payment-connections-page__stats--success"
              : "payment-connections-page__stats--warning"
          }`}
        >
          {activeCount === connectedGatewayCount ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : (
            <AlertCircle size={16} aria-hidden="true" />
          )}
          <span>
            {activeCount} de {connectedGatewayCount}{" "}
            {connectedGatewayCount === 1 ? "gateway" : "gateways"}{" "}
            {activeCount === 1 ? "ativo" : "ativos"}
            {activeCount === connectedGatewayCount
              ? ` e pronta${activeCount === 1 ? "" : "s"} para transações.`
              : ". Verifique as conexões pendentes."}
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDisconnect != null}
        variant="danger"
        title={pendingDisconnect ? `Desconectar ${PROVIDER_LABELS[pendingDisconnect]}?` : ""}
        description="A conexão atual será removida. Você poderá conectar novamente do zero em seguida. Cobranças por este provedor deixam de funcionar até reconectar."
        confirmLabel="Desconectar"
        cancelLabel="Cancelar"
        onConfirm={() => {
          const p = pendingDisconnect;
          setPendingDisconnect(null);
          if (p) void disconnect(p);
        }}
        onCancel={() => setPendingDisconnect(null)}
      />

      <SidePanel isOpen={asaasFormOpen} title="Conectar Asaas" onClose={() => { if (!asaasSaving) setAsaasFormOpen(false); }}>
        {alert?.kind === "error" && <p role="alert" style={{ color: "var(--color-danger)", lineHeight: 1.5 }}>{alert.message}</p>}
        <AsaasConnectionForm
          company={companyPrefill}
          defaultName={me?.name ?? undefined}
          saving={asaasSaving}
          onCancel={() => setAsaasFormOpen(false)}
          onSubmit={(payload) => {
            void connectAsaasAccount(payload).then((ok) => {
              if (ok) setAsaasFormOpen(false);
            });
          }}
        />
      </SidePanel>
    </div>
  );
}
