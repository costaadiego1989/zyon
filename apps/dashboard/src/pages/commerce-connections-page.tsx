import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Link2, PlugZap, RefreshCw, ShoppingBag, Trash2, X, Zap } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type CommerceConnection,
  type ConnectCommercePayload,
  type MerchantProfile,
} from "../api-client.js";

// ── Exported constants for testing ──────────────────────────────────────────

export const SHOPIFY_TOKEN_PATTERN = /^shpat_[a-f0-9]{32,}$/;
export const WOOCOMMERCE_KEY_PATTERN = /^ck_[a-f0-9]{32,}$/;
export const WOOCOMMERCE_SECRET_PATTERN = /^cs_[a-f0-9]{32,}$/;

// ── Error sanitization ──────────────────────────────────────────────────────

export function sanitizeError(e: unknown): string {
  if (e instanceof DashboardHttpError) {
    const { status } = e;
    if (status === 401) return "Sessão expirada. Faça login novamente.";
    if (status === 403) return "Sem permissão para esta ação.";
    if (status === 409) return "Já existe uma conexão ativa. Remova a atual primeiro.";
    if (status === 422) return "Credenciais inválidas. Verifique os dados e tente novamente.";
    if (status >= 500) return "Erro interno. Tente novamente em alguns minutos.";
    return "Ocorreu um erro inesperado. Tente novamente.";
  }
  if (e instanceof TypeError) return "Sem conexão com o servidor.";
  console.error("[commerce-connections]", e);
  return "Ocorreu um erro inesperado. Tente novamente.";
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

type Provider = "shopify" | "woocommerce";
type Operation = "idle" | "loading" | "testing" | "connecting" | "syncing" | "deleting";

const PROVIDERS: Provider[] = ["shopify", "woocommerce"];

const PROVIDER_LABELS: Record<string, string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
};

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01", "2023-10"];

function statusBadge(status: string) {
  if (status === "healthy")
    return <span className="badge ok"><CheckCircle2 size={11} /> Ativo</span>;
  if (status === "degraded")
    return <span className="badge bad"><AlertCircle size={11} /> Com problemas</span>;
  return <span className="badge warn"><Clock size={11} /> Pendente</span>;
}

function statusAccentClass(status: string): string {
  if (status === "healthy") return "commerce-status-accent--healthy";
  if (status === "degraded") return "commerce-status-accent--degraded";
  return "commerce-status-accent--pending";
}

// ── Component ───────────────────────────────────────────────────────────────

export function CommerceConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [connections, setConnections] = useState<CommerceConnection[]>([]);
  const [operation, setOperation] = useState<Operation>("idle");
  const [alert, setAlert] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form state
  const [provider, setProvider] = useState<Provider>("shopify");
  const [shopDomain, setShopDomain] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [storefrontToken, setStorefrontToken] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");

  // Delete confirmation
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isBusy = operation !== "idle" && operation !== "loading";

  useEffect(() => {
    return () => {
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!props.me) {
      setConnections([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  function showAlert(message: string, kind: "success" | "error") {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    setAlert({ message, kind });
    if (kind === "success") {
      alertTimerRef.current = setTimeout(() => setAlert(null), 8000);
    }
  }

  async function load() {
    setOperation("loading");
    setAlert(null);
    try {
      setConnections(await api.getCommerceConnections());
    } catch (e) {
      showAlert(sanitizeError(e), "error");
    } finally {
      setOperation("idle");
    }
  }

  async function createConnection(event: React.FormEvent) {
    event.preventDefault();
    setOperation("connecting");
    setAlert(null);
    try {
      const payload: ConnectCommercePayload =
        provider === "shopify"
          ? {
              provider,
              shop_domain: shopDomain.trim(),
              admin_access_token: adminToken.trim(),
              ...(storefrontToken.trim() ? { storefront_access_token: storefrontToken.trim() } : {}),
              ...(apiVersion ? { api_version: apiVersion } : {}),
            }
          : {
              provider,
              store_url: storeUrl.trim(),
              consumer_key: consumerKey.trim(),
              consumer_secret: consumerSecret.trim(),
            };
      const created = await api.createCommerceConnection(payload);
      setConnections([created]);
      setShopDomain("");
      setAdminToken("");
      setStorefrontToken("");
      setApiVersion("");
      setStoreUrl("");
      setConsumerKey("");
      setConsumerSecret("");
      showAlert("Conexão criada com sucesso.", "success");
    } catch (e) {
      showAlert(sanitizeError(e), "error");
    } finally {
      setOperation("idle");
    }
  }

  async function testConnection() {
    setOperation("testing");
    setAlert(null);
    try {
      const result = await api.testCommerceConnection();
      setConnections([result.connection]);
      showAlert(`Teste bem-sucedido — ${result.store_name} (${result.currency}).`, "success");
    } catch (e) {
      showAlert(sanitizeError(e), "error");
    } finally {
      setOperation("idle");
    }
  }

  async function syncConnection() {
    setOperation("syncing");
    setAlert(null);
    try {
      const updated = await api.syncCommerceConnection();
      setConnections([updated]);
      showAlert("Produtos sincronizados com sucesso.", "success");
    } catch (e) {
      showAlert(sanitizeError(e), "error");
    } finally {
      setOperation("idle");
    }
  }

  async function deleteConnection() {
    setOperation("deleting");
    setAlert(null);
    try {
      await api.deleteCommerceConnection();
      setConnections([]);
      setConfirmingDelete(false);
      showAlert("Conexão removida.", "success");
    } catch (e) {
      showAlert(sanitizeError(e), "error");
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
            <h1>Conexões de Commerce</h1>
            <p className="page-lead">Integre com Shopify e WooCommerce.</p>
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

  const hasConnection = connections.length > 0;
  const isLoading = operation === "loading";

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Commerce</span>
          <h1>Conexões de Plataforma</h1>
          <p className="page-lead">Conecte sua loja Shopify ou WooCommerce para sincronizar pedidos.</p>
        </div>
        <button type="button" disabled={isLoading || isBusy} onClick={() => void load()}>
          <RefreshCw size={15} className={isLoading ? "spin" : undefined} />
          Atualizar
        </button>
      </header>

      {/* Connection KPIs */}
      {!isLoading && hasConnection && connections[0] ? (
        <div className="metrics">
          <article className="metric">
            <Link2 size={18} aria-hidden />
            <span className="metric-value">{connections[0].provider === "shopify" ? "Shopify" : "WooCommerce"}</span>
            <span className="metric-label">Plataforma</span>
          </article>
          <article className="metric">
            <ShoppingBag size={18} aria-hidden />
            <span className="metric-value">{connections[0].product_count ?? "—"}</span>
            <span className="metric-label">Produtos sincronizados</span>
          </article>
          <article className="metric">
            <Clock size={18} aria-hidden />
            <span className="metric-value">
              {connections[0].last_synced_at
                ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(connections[0].last_synced_at))
                : "Nunca"}
            </span>
            <span className="metric-label">Último sync</span>
          </article>
          <article className="metric">
            <Zap size={18} aria-hidden />
            <span className="metric-value">
              <span className={connections[0].status === "active" ? "badge ok" : "badge warn"}>
                {connections[0].status === "active" ? "Ativa" : connections[0].status}
              </span>
            </span>
            <span className="metric-label">Status</span>
          </article>
        </div>
      ) : null}

      {/* Alert banner */}
      {alert ? (
        <div
          role="alert"
          aria-live="polite"
          className={`commerce-alert ${alert.kind === "error" ? "commerce-alert--error" : "commerce-alert--success"}`}
        >
          {alert.kind === "error" ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{alert.message}</span>
          {alert.kind === "error" ? (
            <button
              type="button"
              className="commerce-alert-dismiss"
              onClick={() => setAlert(null)}
              aria-label="Fechar alerta"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Add connection form — one active connection per merchant */}
      {!hasConnection && !isLoading ? (
        <section className="panel stacked commerce-form-section">
          <div className="panel-title">
            <div className="commerce-form-header">
              <div className="commerce-form-icon">
                <PlugZap size={18} />
              </div>
              <div>
                <h2>Nova Conexão</h2>
                <p>Credenciais ficam criptografadas; uma conexão ativa por loja.</p>
              </div>
            </div>
          </div>

          <form
            onSubmit={(e) => void createConnection(e)}
            className="commerce-form-grid"
          >
            <div className="commerce-credential-row">
              <label>
                Plataforma
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  disabled={isBusy}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              {provider === "shopify" ? (
                <label>
                  Domínio da loja
                  <input
                    type="text"
                    placeholder="minhaloja.myshopify.com"
                    value={shopDomain}
                    onChange={(e) => setShopDomain(e.target.value)}
                    disabled={isBusy}
                    required
                    minLength={3}
                  />
                </label>
              ) : (
                <label>
                  URL da loja
                  <input
                    type="url"
                    placeholder="https://minhaloja.com.br"
                    value={storeUrl}
                    onChange={(e) => setStoreUrl(e.target.value)}
                    disabled={isBusy}
                    required
                  />
                </label>
              )}
            </div>

            {provider === "shopify" ? (
              <>
                <label>
                  Token de acesso admin
                  <input
                    type="password"
                    placeholder="shpat_..."
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    disabled={isBusy}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  {adminToken && !SHOPIFY_TOKEN_PATTERN.test(adminToken) ? (
                    <span className="commerce-field-warning">Formato esperado: shpat_ seguido de 32+ caracteres hexadecimais</span>
                  ) : null}
                </label>
                <label>
                  Token storefront (opcional)
                  <input
                    type="password"
                    placeholder="shpat_... (opcional)"
                    value={storefrontToken}
                    onChange={(e) => setStorefrontToken(e.target.value)}
                    disabled={isBusy}
                    autoComplete="new-password"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                </label>
                <label>
                  Versão da API (opcional)
                  <select
                    value={apiVersion}
                    onChange={(e) => setApiVersion(e.target.value)}
                    disabled={isBusy}
                  >
                    <option value="">Padrão do servidor</option>
                    {API_VERSIONS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <div className="commerce-credential-row">
                <label>
                  Chave do consumidor
                  <input
                    type="password"
                    placeholder="ck_..."
                    value={consumerKey}
                    onChange={(e) => setConsumerKey(e.target.value)}
                    disabled={isBusy}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  {consumerKey && !WOOCOMMERCE_KEY_PATTERN.test(consumerKey) ? (
                    <span className="commerce-field-warning">Formato esperado: ck_ seguido de 32+ caracteres hexadecimais</span>
                  ) : null}
                </label>
                <label>
                  Segredo do consumidor
                  <input
                    type="password"
                    placeholder="cs_..."
                    value={consumerSecret}
                    onChange={(e) => setConsumerSecret(e.target.value)}
                    disabled={isBusy}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  {consumerSecret && !WOOCOMMERCE_SECRET_PATTERN.test(consumerSecret) ? (
                    <span className="commerce-field-warning">Formato esperado: cs_ seguido de 32+ caracteres hexadecimais</span>
                  ) : null}
                </label>
              </div>
            )}

            <button type="submit" className="btn-primary commerce-submit-btn" disabled={isBusy}>
              <Zap size={15} />
              {operation === "connecting" ? "Conectando..." : "Conectar"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Active connection */}
      <section>
        <div className="section-header">
          <h2>Conexão Ativa</h2>
        </div>

        {isLoading ? (
          <div className="panel skeleton" style={{ height: 88 }} />
        ) : !hasConnection ? (
          <div className="panel stacked">
            <div className="empty-state">
              <div className="empty-state-icon"><Link2 size={22} /></div>
              <h3>Nenhuma conexão configurada</h3>
              <p>Conecte sua plataforma de e-commerce usando o formulário acima.</p>
            </div>
          </div>
        ) : (
          <div className="commerce-connection-list">
            {connections.map((conn) => (
              <article
                key={conn.provider}
                className={`panel stacked commerce-connection-card ${statusAccentClass(conn.status)}`}
              >
                <div className="commerce-card-body">
                  {/* Platform icon */}
                  <div className="commerce-card-icon">
                    <ShoppingBag size={18} />
                  </div>

                  {/* Main info */}
                  <div className="commerce-card-info">
                    <div className="commerce-card-title-row">
                      <strong>{PROVIDER_LABELS[conn.provider] ?? conn.provider}</strong>
                      {statusBadge(conn.status)}
                      {conn.api_version ? (
                        <span className="badge muted">v{conn.api_version}</span>
                      ) : null}
                      {conn.last_error_code ? (
                        <span className="badge bad" title={conn.last_error_code}>{conn.last_error_code}</span>
                      ) : null}
                    </div>
                    <div className="commerce-card-meta">
                      <span className="commerce-card-url">{conn.store_url}</span>
                      {conn.last_tested_at ? (
                        <span className="commerce-card-date">Testado {formatDate(conn.last_tested_at)}</span>
                      ) : null}
                      {conn.last_synced_at ? (
                        <span className="commerce-card-date">Sincronizado {formatDate(conn.last_synced_at)}</span>
                      ) : null}
                      <span className="commerce-card-date">Atualizado {formatDate(conn.updated_at)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="commerce-actions">
                    {confirmingDelete ? (
                      <>
                        <span className="commerce-confirm-text">Tem certeza?</span>
                        <button
                          type="button"
                          className="btn-danger-subtle"
                          disabled={operation === "deleting"}
                          onClick={() => void deleteConnection()}
                        >
                          <Trash2 size={14} />
                          {operation === "deleting" ? "Removendo..." : "Confirmar"}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={operation === "deleting"}
                          onClick={() => setConfirmingDelete(false)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void testConnection()}
                        >
                          <Zap size={14} />
                          {operation === "testing" ? "Testando..." : "Testar"}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void syncConnection()}
                        >
                          <RefreshCw size={14} />
                          {operation === "syncing" ? "Sincronizando..." : "Sincronizar"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger-subtle"
                          disabled={isBusy}
                          onClick={() => setConfirmingDelete(true)}
                        >
                          <Trash2 size={14} />
                          Remover
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
