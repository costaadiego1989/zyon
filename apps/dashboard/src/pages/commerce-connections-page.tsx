import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Link2, PlugZap, RefreshCw, ShoppingBag, Trash2, X, Zap } from "lucide-react";
import {
  DashboardHttpError,
  type CommerceConnection,
  type ConnectCommercePayload,
  type MerchantProfile,
} from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { Button } from "../components/Button.js";

// ── Exported constants for testing ──────────────────────────────────────────

export const WOOCOMMERCE_KEY_PATTERN = /^ck_[a-f0-9]{32,}$/;
export const WOOCOMMERCE_SECRET_PATTERN = /^cs_[a-f0-9]{32,}$/;
export const MAGENTO_TOKEN_PATTERN = /^[a-z0-9]{32,}$/;

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

type Provider = "woocommerce" | "magento" | "native";
type Operation = "idle" | "loading" | "testing" | "connecting" | "syncing" | "deleting";

const PROVIDERS: Provider[] = ["native", "woocommerce", "magento"];

const PROVIDER_LABELS: Record<string, string> = {
  native: "Integração Nativa (Embed)",
  woocommerce: "WooCommerce",
  magento: "Magento / Adobe Commerce",
};

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
  const [provider, setProvider] = useState<Provider>("native");
  const [storeUrl, setStoreUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [magentoBaseUrl, setMagentoBaseUrl] = useState("");
  const [magentoToken, setMagentoToken] = useState("");
  const [magentoStoreCode, setMagentoStoreCode] = useState("default");

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
      if (provider === "native") {
        payload = {
          provider: "native",
          store_url: storeUrl.trim() || "embed://direct",
        };
      } else if (provider === "magento") {
        payload = {
          provider: "magento",
          store_url: magentoBaseUrl.trim(),
          access_token: magentoToken.trim(),
          ...(magentoStoreCode.trim() !== "default" ? { store_code: magentoStoreCode.trim() } : {}),
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
      setStoreUrl("");
      setConsumerKey("");
      setConsumerSecret("");
      setMagentoBaseUrl("");
      setMagentoToken("");
      setMagentoStoreCode("default");
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
        <Button variant="outline" disabled={isLoading || isBusy} onClick={() => void load()}>
          <RefreshCw size={15} className={isLoading ? "spin" : undefined} style={{ marginRight: 6 }} />
          Atualizar
        </Button>
      </header>

      {/* Connection KPIs */}
      {!isLoading && hasConnection && connections[0] ? (
        <div className="metrics">
          <div className="metric">
            <span><Link2 size={14} /> Plataforma</span>
            <strong>{PROVIDER_LABELS[connections[0].provider] ?? connections[0].provider}</strong>
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
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--muted)", opacity: 0.6, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    VTEX <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "var(--border)", fontWeight: 600 }}>EM BREVE</span>
                  </span>
                </div>
              </label>
              {provider !== "native" ? (
                <label>
                  URL da loja
                  <input
                    type="url"
                    placeholder={provider === "magento" ? "https://magento.minhaloja.com.br" : "https://minhaloja.com.br"}
                    value={provider === "magento" ? magentoBaseUrl : storeUrl}
                    onChange={(e) => provider === "magento" ? setMagentoBaseUrl(e.target.value) : setStoreUrl(e.target.value)}
                    disabled={isBusy}
                    required
                  />
                </label>
              ) : null}
            </div>

            {provider === "woocommerce" ? (
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
            ) : null}

            {provider === "magento" ? (
              <div className="commerce-credential-row">
                <label>
                  Token de acesso (Integration Token)
                  <input
                    type="password"
                    placeholder="Token gerado em System → Integrations"
                    value={magentoToken}
                    onChange={(e) => setMagentoToken(e.target.value)}
                    disabled={isBusy}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  {magentoToken && !MAGENTO_TOKEN_PATTERN.test(magentoToken) ? (
                    <span className="commerce-field-warning">Formato esperado: 32+ caracteres alfanuméricos</span>
                  ) : null}
                </label>
                <label>
                  Store Code
                  <input
                    type="text"
                    placeholder="default"
                    value={magentoStoreCode}
                    onChange={(e) => setMagentoStoreCode(e.target.value)}
                    disabled={isBusy}
                  />
                  <small style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Código da store view (geralmente "default")</small>
                </label>
              </div>
            ) : null}

            {provider === "native" ? (
              <div style={{ padding: '20px 24px', background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <p style={{ fontSize: 13, color: 'var(--fg)', margin: 0, fontWeight: 500, lineHeight: 1.5 }}>
                    Integração nativa via embed
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
                    O widget Zyon é o checkout completo. Sem dependência de plataforma externa.
                    Gere uma API key em Desenvolvedores e use o snippet abaixo no seu site.
                  </p>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>Domínio autorizado (opcional)</span>
                  <input
                    type="url"
                    placeholder="https://minhaloja.com.br"
                    value={storeUrl}
                    onChange={(e) => setStoreUrl(e.target.value)}
                    disabled={isBusy}
                    style={{ padding: '10px 14px', borderRadius: 8 }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Restringe o widget a funcionar apenas neste domínio</span>
                </label>

                {/* Embed snippet */}
                <div style={{ marginTop: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', display: 'block', marginBottom: 8 }}>Snippet de instalação</span>
                  <pre style={{ margin: 0, padding: '14px 16px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', fontSize: 11, lineHeight: 1.6, color: 'var(--fg)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`<!-- 1. Carregue o widget -->
<script src="${props.apiBaseUrl}/widget/aacp.js" async></script>

<!-- 2. Cole onde o checkout deve aparecer -->
<zyon-checkout-agent
  merchant-id="${props.me?.id ?? 'SEU_MERCHANT_ID'}"
  api-base-url="${props.apiBaseUrl}"
  embed-session-token="TOKEN_DO_SEU_BACKEND"
></zyon-checkout-agent>`}
                  </pre>
                  <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)' }}>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--fg)' }}>Como gerar o token:</strong> No seu backend, chame <code style={{ fontSize: 10, padding: '1px 4px', borderRadius: 3, background: 'var(--bg)' }}>POST /embed-sessions</code> com sua API key (criada em Desenvolvedores). O token retornado é temporário e deve ser gerado por sessão.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

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

              <Button type="submit" variant="primary" arrow disabled={isBusy} loading={operation === "connecting"}>
                <Zap size={15} style={{ marginRight: 6 }} />
                {operation === "connecting" ? "Conectando..." : "Conectar loja"}
              </Button>
            </div>
          </form>
        </section>
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
                        <Button
                          variant="ghost"
                          disabled={operation === "deleting"}
                          onClick={() => void deleteConnection()}
                        >
                          <Trash2 size={14} style={{ marginRight: 6 }} />
                          {operation === "deleting" ? "Removendo..." : "Confirmar"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={operation === "deleting"}
                          onClick={() => setConfirmingDelete(false)}
                        >
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void testConnection()}
                        >
                          <Zap size={14} style={{ marginRight: 6 }} />
                          {operation === "testing" ? "Testando..." : "Testar"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void syncConnection()}
                        >
                          <RefreshCw size={14} style={{ marginRight: 6 }} />
                          {operation === "syncing" ? "Sincronizando..." : "Sincronizar agora"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={isBusy}
                          onClick={() => setConfirmingDelete(true)}
                        >
                          <Trash2 size={14} style={{ marginRight: 6 }} />
                          Remover conexão
                        </Button>
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
