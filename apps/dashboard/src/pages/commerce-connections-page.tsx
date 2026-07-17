import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Link2, PlugZap, RefreshCw, ShoppingBag, Trash2, X, Zap } from "lucide-react";
import {
  DashboardHttpError,
  type CommerceConnection,
  type ConnectCommercePayload,
  type MerchantProfile,
} from "../api-client.js";
import { useApi } from "../hooks/useApi.js";

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
    if (status === 422) return "Não foi possível conectar. Verifique as credenciais e tente novamente.";
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

type Provider = "shopify" | "woocommerce" | "nuvemshop" | "tray";
type Operation = "idle" | "loading" | "testing" | "connecting" | "syncing" | "deleting";

const PROVIDERS: Provider[] = ["shopify", "woocommerce", "nuvemshop", "tray"];

const PROVIDER_LABELS: Record<string, string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  nuvemshop: "Nuvemshop",
  tray: "Tray Commerce",
};

const PROVIDER_DOCS: Record<string, string> = {
  shopify: "https://shopify.dev/docs/api/admin-rest",
  woocommerce: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
  nuvemshop: "https://tiendanube.github.io/api-documentation/intro",
  tray: "https://developers.tray.com.br",
};

const PROVIDER_HELP: Record<string, string> = {
  shopify: "Gere o token em Settings → Apps → Develop apps → Admin API",
  woocommerce: "Gere as chaves em WooCommerce → Settings → Advanced → REST API",
  nuvemshop: "Obtenha o token via Partner Portal ou app autorizado no painel Nuvemshop",
  tray: "Cadastre o app no painel Tray e autorize via OAuth para obter o access_token",
};

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01", "2023-10"];

function statusBadge(status: string) {
  if (status === "healthy")
    return <span className="badge ok"><CheckCircle2 size={11} /> Ativo</span>;
  if (status === "degraded")
    return <span className="badge bad"><AlertCircle size={11} /> Erro de sincronização</span>;
  return <span className="badge warn"><Clock size={11} /> Pendente</span>;
}

function statusAccentClass(status: string): string {
  if (status === "healthy") return "commerce-status-accent--healthy";
  if (status === "degraded") return "commerce-status-accent--degraded";
  return "commerce-status-accent--pending";
}

// ── Component ───────────────────────────────────────────────────────────────

export function CommerceConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useApi();
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
  const [nuvemshopStoreId, setNuvemshopStoreId] = useState("");
  const [nuvemshopToken, setNuvemshopToken] = useState("");
  const [trayApiAddress, setTrayApiAddress] = useState("");
  const [trayAccessToken, setTrayAccessToken] = useState("");

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
      let payload: ConnectCommercePayload;
      if (provider === "shopify") {
        payload = {
          provider: "shopify",
          shop_domain: shopDomain.trim(),
          admin_access_token: adminToken.trim(),
          ...(storefrontToken.trim() ? { storefront_access_token: storefrontToken.trim() } : {}),
          ...(apiVersion ? { api_version: apiVersion } : {}),
        };
      } else if (provider === "nuvemshop") {
        payload = {
          provider: "nuvemshop",
          store_url: nuvemshopStoreId.trim(),
          access_token: nuvemshopToken.trim(),
        };
      } else if (provider === "tray") {
        payload = {
          provider: "tray",
          store_url: trayApiAddress.trim(),
          access_token: trayAccessToken.trim(),
        };
      } else {
        payload = {
          provider: "woocommerce",
          store_url: storeUrl.trim(),
          consumer_key: consumerKey.trim(),
          consumer_secret: consumerSecret.trim(),
        };
      }
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
            <p className="page-lead">Conecte sua loja para sincronizar produtos e pedidos automaticamente.</p>
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
          <p className="page-lead">Conecte sua loja para sincronizar produtos e pedidos automaticamente.</p>
        </div>
        <button type="button" disabled={isLoading || isBusy} onClick={() => void load()}>
          <RefreshCw size={15} className={isLoading ? "spin" : undefined} />
          Atualizar
        </button>
      </header>

      {/* Connection KPIs */}
      {!isLoading && hasConnection && connections[0] ? (
        <div className="metrics">
          <div className="metric">
            <span><Link2 size={14} /> Plataforma</span>
            <strong>{connections[0].provider === "shopify" ? "Shopify" : "WooCommerce"}</strong>
          </div>
          <div className="metric">
            <span><ShoppingBag size={14} /> Produtos</span>
            <strong>{"product_count" in connections[0] && typeof (connections[0] as { product_count?: unknown }).product_count === "number" ? (connections[0] as { product_count: number }).product_count : "—"}</strong>
          </div>
          <div className="metric">
            <span><Clock size={14} /> Último sync</span>
            <strong>
              {connections[0].last_synced_at
                ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(connections[0].last_synced_at))
                : "Nunca"}
            </strong>
          </div>
          <div className="metric">
            <span><Zap size={14} /> Status</span>
            <strong>
              <span className={connections[0].status === "active" ? "badge ok" : "badge warn"}>
                {connections[0].status === "active" ? "Ativa" : connections[0].status}
              </span>
            </strong>
          </div>
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
                <h2>Conectar plataforma</h2>
                <p>Informe as credenciais da sua loja. Dados criptografados em repouso.</p>
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
                  <small style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Sem https:// — apenas o subdomínio .myshopify.com</small>
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
                  Token de acesso (Admin API)
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
                  <small style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Gere em Shopify Admin → Settings → Apps → Develop apps → Admin API access token</small>
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
                  Versão da API
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
                  Chave do consumidor (Consumer Key)
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
                  Segredo do consumidor (Consumer Secret)
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

            {provider === "nuvemshop" ? (
              <>
                <label>
                  ID da loja (store_id)
                  <input
                    type="text"
                    placeholder="1234567"
                    value={nuvemshopStoreId}
                    onChange={(e) => setNuvemshopStoreId(e.target.value)}
                    disabled={isBusy}
                    required
                    minLength={3}
                  />
                  <small style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Encontre em Nuvemshop Admin → Configurações → Identificação</small>
                </label>
                <label>
                  Access Token
                  <input
                    type="password"
                    placeholder="Token gerado via Partner Portal ou app OAuth"
                    value={nuvemshopToken}
                    onChange={(e) => setNuvemshopToken(e.target.value)}
                    disabled={isBusy}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  <small style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Gere via app autorizado no Partner Portal Nuvemshop</small>
                </label>
              </>
            ) : null}

            {provider === "tray" ? (
              <>
                <label>
                  URL da API (api_address)
                  <input
                    type="url"
                    placeholder="https://minhaloja.com.br/web_api"
                    value={trayApiAddress}
                    onChange={(e) => setTrayApiAddress(e.target.value)}
                    disabled={isBusy}
                    required
                  />
                  <small style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Endereço retornado após autorização OAuth no painel Tray</small>
                </label>
                <label>
                  Access Token
                  <input
                    type="password"
                    placeholder="Token retornado pelo fluxo OAuth"
                    value={trayAccessToken}
                    onChange={(e) => setTrayAccessToken(e.target.value)}
                    disabled={isBusy}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  <small style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Obtido após autorizar o app via OAuth na loja Tray</small>
                </label>
              </>
            ) : null}

            {/* Documentation link */}
            <div style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <a
                href={PROVIDER_DOCS[provider]}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '12px', color: 'var(--color-brand)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                Documentação {PROVIDER_LABELS[provider]} ↗
              </a>
              <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                {PROVIDER_HELP[provider]}
              </span>
            </div>

            <button type="submit" className="btn-primary commerce-submit-btn" disabled={isBusy}>
              <Zap size={15} />
              {operation === "connecting" ? "Conectando..." : "Conectar loja"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Upcoming integrations */}
      {!hasConnection ? (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px", marginBottom: 20 }}>
          <h3 style={{ font: "600 14px var(--serif)", color: "var(--ink)", marginBottom: 12 }}>Em breve</h3>
          <p style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)", marginBottom: 14 }}>Estamos trabalhando em mais integrações nativas.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {["VTEX", "Magento", "Yampi", "Loja Integrada"].map(name => (
              <span key={name} style={{ font: "500 11px var(--mono)", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--muted)" }}>{name}</span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Active connection */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "22px", marginBottom: 20 }}>
        <h2 style={{ font: "600 14px var(--serif)", color: "var(--ink)", marginBottom: 16 }}>Conexão Ativa</h2>

        {isLoading ? (
          <div style={{ height: 88, borderRadius: 8, background: "var(--bg)" }} />
        ) : !hasConnection ? (
          <div style={{ padding: "40px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}><Link2 size={22} color="var(--faint)" /></div>
            <strong style={{ font: "600 14px var(--sans)", color: "var(--ink)" }}>Nenhuma conexão configurada</strong>
            <p style={{ font: "13px var(--sans)", color: "var(--faint)", maxWidth: 360 }}>Conecte uma plataforma de e-commerce para importar catálogo e sincronizar pedidos.</p>
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
                          {operation === "syncing" ? "Sincronizando..." : "Sincronizar agora"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger-subtle"
                          disabled={isBusy}
                          onClick={() => setConfirmingDelete(true)}
                        >
                          <Trash2 size={14} />
                          Remover conexão
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
