import React, { useState } from "react";
import { AlertCircle, CheckCircle2, CreditCard, PlugZap, RefreshCw } from "lucide-react";
import type { PaymentConnection } from "../../api-client.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { GatewayCard } from "./components/GatewayCard.js";
import { WalletSection } from "./components/WalletSection.js";
import { StripeLogo, AsaasLogo, MercadoPagoLogo } from "./components/ProviderLogos.js";
import { usePaymentConnectionsPage, formatDate, type CryptoWalletState } from "./usePaymentConnectionsPage.js";
import type { MerchantProfile } from "../../api-client.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { SidePanel } from "../../components/SidePanel.js";
import { AsaasSubaccountForm, type AsaasSubaccountPayload } from "./components/AsaasSubaccountForm.js";
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

export function PaymentConnectionsPage({ me }: PaymentConnectionsPageProps) {
  const {
    connections,
    operation,
    alert,
    crypto,
    companyPrefill,
    setCrypto,
    load,
    onboardStripe,
    syncStripe,
    createAsaasSubaccount,
    openAsaasOnboarding,
    syncAsaas,
    onboardMercadoPago,
    syncMercadoPago,
    disconnect,
    saveCryptoWallet,
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
  const activeCount = connections.filter((c) => c.status === "active").length + (crypto.config.enabled ? 1 : 0);

  return (
    <div className="page-container payment-connections-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Conexões de pagamento</h1>
          <p className="page-lead">Configure gateways e carteiras para receber pagamentos</p>
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
          />
          <GatewayCard
            provider="asaas"
            name="Asaas"
            description="PIX, boleto e cartão Brasil"
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
          />
          <GatewayCard
            provider="mercadopago"
            name="Mercado Pago"
            description="PIX, cartão e boleto — América Latina"
            iconBg="#fff"
            icon={<MercadoPagoLogo size={52} />}
            connection={mercadopagoConn}
            operation={operation}
            connectingOperation="connecting-mercadopago"
            syncingOperation="syncing-mercadopago"
            onConnect={() => void onboardMercadoPago()}
            onSync={() => void syncMercadoPago()}
            onDisconnect={() => setPendingDisconnect("mercadopago")}
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

      <SidePanel isOpen={asaasFormOpen} title="Conectar Asaas" onClose={() => setAsaasFormOpen(false)}>
        <AsaasSubaccountForm
          company={companyPrefill}
          defaultName={me?.name ?? undefined}
          saving={asaasSaving}
          onCancel={() => setAsaasFormOpen(false)}
          onSubmit={(payload: AsaasSubaccountPayload) => {
            void createAsaasSubaccount(payload as unknown as Record<string, unknown>).then((ok) => {
              if (ok) setAsaasFormOpen(false);
            });
          }}
        />
      </SidePanel>
    </div>
  );
}
