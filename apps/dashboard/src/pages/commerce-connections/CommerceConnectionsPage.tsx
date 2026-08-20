import React, { useEffect } from "react";
import { AlertCircle, CheckCircle2, Clock, Link2, PlugZap, RefreshCw, ShoppingBag, Store, X, Zap } from "lucide-react";
import { EmptyState } from "../../components/EmptyState.js";
import type { MerchantProfile, ConnectCommercePayload } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { FormSelect } from "../../components/FormField.js";
import { useCommerceConnections, sanitizeError } from "./hooks/useCommerceConnections.js";
import { useApiKeyAuth } from "./hooks/useApiKeyAuth.js";
import { useNativeAuth } from "./hooks/useNativeAuth.js";
import { ProviderCard, PROVIDER_LABELS } from "./components/ProviderCard.js";
import { ApiKeyPanel } from "./components/ApiKeyPanel.js";
import { OAuthFlowPanel } from "./components/OAuthFlowPanel.js";

type Provider = "woocommerce" | "magento" | "native";

const PROVIDERS: Provider[] = ["native", "woocommerce", "magento"];

const PROVIDER_DOCS: Record<string, string> = {
  native: "https://docs.zyon.com.br/embed",
  woocommerce: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
  magento: "https://developer.adobe.com/commerce/webapi/rest/",
};

const PROVIDER_HELP: Record<string, string> = {
  native: "Embed direto via script tag — sem dependência de plataforma externa",
  woocommerce: "Gere as chaves em WooCommerce → Settings → Advanced → REST API",
  magento: "Gere o token em System → Integrations → Add New Integration → API",
};

export function CommerceConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const [provider, setProvider] = React.useState<Provider>("native");
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const connections = useCommerceConnections(props.me);
  const apiKeyAuth = useApiKeyAuth();
  const nativeAuth = useNativeAuth();

  // Reset form on successful connection
  useEffect(() => {
    if (connections.alert?.kind === "success" && connections.operation === "idle") {
      apiKeyAuth.reset();
      nativeAuth.reset();
    }
  }, [connections.alert?.kind, connections.operation, apiKeyAuth, nativeAuth]);

  async function handleCreateConnection(event: React.FormEvent) {
    event.preventDefault();
    try {
      let payload: ConnectCommercePayload;
      if (provider === "native") {
        payload = {
          provider: "native",
          store_url: nativeAuth.state.domain.trim() || "embed://direct",
        };
      } else if (provider === "magento") {
        payload = {
          provider: "magento",
          store_url: apiKeyAuth.state.magentoBaseUrl.trim(),
          access_token: apiKeyAuth.state.magentoToken.trim(),
          ...(apiKeyAuth.state.magentoStoreCode.trim() !== "default" ? { store_code: apiKeyAuth.state.magentoStoreCode.trim() } : {}),
        };
      } else {
        payload = {
          provider: "woocommerce",
          store_url: apiKeyAuth.state.storeUrl.trim(),
          consumer_key: apiKeyAuth.state.consumerKey.trim(),
          consumer_secret: apiKeyAuth.state.consumerSecret.trim(),
        };
      }
      await connections.createConnection(payload);
    } catch {
      // Error already handled in hook
    }
  }

  // ── Unauthenticated state ─────────────────────────────────────────────────

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Conexões de Commerce</h1>
            <p className="page-lead">Conecte sua loja para sincronizar produtos e pedidos automaticamente</p>
          </div>
        </header>
        <div className="panel stacked">
          <div className="empty-state">
            <div className="empty-state-icon"><ShoppingBag size={22} /></div>
            <h3>Login necessário</h3>
            <p>Faça login para gerenciar integrações de loja.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Commerce</span>
          <h1>Conexões de Plataforma</h1>
          <p className="page-lead">Conecte sua loja para sincronizar produtos e pedidos automaticamente</p>
        </div>
        <Button variant="outline" disabled={connections.isLoading || connections.isBusy} onClick={() => void connections.load()}>
          <RefreshCw size={15} className={connections.isLoading ? "spin" : undefined} style={{ marginRight: 6 }} />
          Atualizar
        </Button>
      </header>

      {/* Connection KPIs */}
      {!connections.isLoading && connections.hasConnection && connections.connections[0] ? (
        <div className="metrics">
          <div className="metric">
            <span><Link2 size={14} /> Plataforma</span>
            <strong>{PROVIDER_LABELS[connections.connections[0].provider] ?? connections.connections[0].provider}</strong>
          </div>
          <div className="metric">
            <span><ShoppingBag size={14} /> Produtos</span>
            <strong>{"product_count" in connections.connections[0] && typeof (connections.connections[0] as { product_count?: unknown }).product_count === "number" ? (connections.connections[0] as { product_count: number }).product_count : "—"}</strong>
          </div>
          <div className="metric">
            <span><Clock size={14} /> Último sync</span>
            <strong>
              {connections.connections[0].last_synced_at
                ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(connections.connections[0].last_synced_at))
                : "Nunca"}
            </strong>
          </div>
          <div className="metric">
            <span><Zap size={14} /> Status</span>
            <strong>
              <span className={connections.connections[0].status === "active" ? "badge ok" : "badge warn"}>
                {connections.connections[0].status === "active" ? "Ativa" : connections.connections[0].status}
              </span>
            </strong>
          </div>
        </div>
      ) : null}

      {/* Alert banner */}
      {connections.alert ? (
        <div
          role="alert"
          aria-live="polite"
          className={`commerce-alert ${connections.alert.kind === "error" ? "commerce-alert--error" : "commerce-alert--success"}`}
        >
          {connections.alert.kind === "error" ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{connections.alert.message}</span>
          {connections.alert.kind === "error" ? (
            <button
              type="button"
              className="commerce-alert-dismiss"
              onClick={() => connections.dismissAlert()}
              aria-label="Fechar alerta"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Add connection form — one active connection per merchant */}
      {!connections.hasConnection && !connections.isLoading ? (
        <section className="panel stacked commerce-form-section">
          <SectionHeader title="Conectar plataforma" subtitle="Informe as credenciais da sua loja. Dados criptografados em repouso." />

          <form
            onSubmit={(e) => void handleCreateConnection(e)}
            className="commerce-form-grid"
          >
            <div className="commerce-credential-row">
              <FormSelect
                label="Plataforma"
                value={provider}
                onChange={(v) => setProvider(v as Provider)}
                options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
                disabled={connections.isBusy}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--muted)", opacity: 0.6, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  VTEX <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "var(--border)", fontWeight: 600 }}>EM BREVE</span>
                </span>
              </div>

              {/* API Key Panel */}
              <ApiKeyPanel
                provider={provider}
                isBusy={connections.isBusy}
                operation={connections.operation}
                storeUrl={apiKeyAuth.state.storeUrl}
                consumerKey={apiKeyAuth.state.consumerKey}
                consumerSecret={apiKeyAuth.state.consumerSecret}
                onStoreUrlChange={apiKeyAuth.setStoreUrl}
                onConsumerKeyChange={apiKeyAuth.setConsumerKey}
                onConsumerSecretChange={apiKeyAuth.setConsumerSecret}
                magentoBaseUrl={apiKeyAuth.state.magentoBaseUrl}
                magentoToken={apiKeyAuth.state.magentoToken}
                magentoStoreCode={apiKeyAuth.state.magentoStoreCode}
                onMagentoBaseUrlChange={apiKeyAuth.setMagentoBaseUrl}
                onMagentoTokenChange={apiKeyAuth.setMagentoToken}
                onMagentoStoreCodeChange={apiKeyAuth.setMagentoStoreCode}
              />
            </div>

            {/* OAuth/Native Flow Panel */}
            <OAuthFlowPanel
              provider={provider}
              isBusy={connections.isBusy}
              operation={connections.operation}
              apiBaseUrl={props.apiBaseUrl}
              me={props.me}
              domain={nativeAuth.state.domain}
              onDomainChange={nativeAuth.setDomain}
            />

            {/* Documentation + Submit */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div>
                <a
                  href={PROVIDER_DOCS[provider]}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500 }}
                >
                  Documentação {PROVIDER_LABELS[provider]} ↗
                </a>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {PROVIDER_HELP[provider]}
                </span>
              </div>

              <Button type="submit" variant="primary" arrow disabled={connections.isBusy} loading={connections.operation === "connecting"}>
                <Zap size={15} style={{ marginRight: 6 }} />
                {connections.operation === "connecting" ? "Conectando..." : "Conectar loja"}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {/* Active connection */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px", marginBottom: 20 }}>
        <h2 style={{ font: "600 14px var(--serif)", color: "var(--accent)", marginBottom: 16 }}>Conexão Ativa</h2>

        {connections.isLoading ? (
          <div style={{ height: 88, borderRadius: 8, background: "var(--bg)" }} />
        ) : !connections.hasConnection ? (
          <EmptyState icon={Store} title="Nenhuma conexão configurada" description="Conecte uma plataforma de e-commerce para importar catálogo e sincronizar pedidos." />
        ) : (
          <div className="commerce-connection-list">
            {connections.connections.map((conn) => (
              <ProviderCard
                key={conn.provider}
                connection={conn}
                operation={connections.operation}
                isBusy={connections.isBusy}
                onTest={() => void connections.testConnection()}
                onSync={() => void connections.syncConnection()}
                onDelete={() => void connections.deleteConnection()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
