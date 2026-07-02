import React, { useMemo, useState } from "react";
import { CheckCircle2, Code2, Copy, KeyRound, Shield, Terminal } from "lucide-react";
import { createDashboardApi, DashboardHttpError, type EmbedSessionResponse, type MerchantProfile } from "../api-client.js";

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

const SCOPE_META: Record<string, { ok: boolean; label: string; description: string }> = {
  "checkout:start":        { ok: true,  label: "Iniciar sessão", description: "Permite abrir uma nova sessão de checkout para o comprador" },
  "checkout:track":        { ok: true,  label: "Rastrear progresso", description: "Acompanha em que etapa do checkout o comprador está" },
  "checkout:chat":         { ok: true,  label: "Chat do agente", description: "Habilita a conversa com o assistente de compras" },
  "offers:apply":          { ok: true,  label: "Aplicar ofertas", description: "Permite que ofertas aprovadas sejam aplicadas ao carrinho" },
  "coupons:apply":         { ok: true,  label: "Cupons", description: "Permite aplicar cupons de desconto durante o checkout" },
  "payment:intents:create":{ ok: false, label: "Criar pagamentos", description: "Autoriza a criação de intenções de pagamento (sensível)" },
};

// ── Utility Functions (exported for testing) ─────────────────────────────────

export function formatExpiry(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const formatted = date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const diffMs = unixSeconds * 1000 - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 0) return `${formatted} (expirado)`;
  if (diffMin < 60) return `${formatted} (expira em ${diffMin} min)`;
  const diffH = Math.round(diffMin / 60);
  return `${formatted} (expira em ${diffH}h)`;
}

export function validateEmbedForm(params: {
  allowedOrigin: string;
  cartRef: string;
  ttl: number;
  scopes: string[];
}): Record<string, string> {
  const errors: Record<string, string> = {};
  try {
    const url = new URL(params.allowedOrigin);
    if (!['http:', 'https:'].includes(url.protocol)) {
      errors.allowedOrigin = "Protocolo deve ser http ou https";
    }
  } catch {
    errors.allowedOrigin = "URL inválida. Ex: https://minha-loja.com";
  }
  if (!params.cartRef.trim()) {
    errors.cartRef = "Referência do carrinho é obrigatória";
  }
  if (params.ttl < 60 || params.ttl > 86400) {
    errors.ttl = "TTL deve estar entre 60 e 86400 segundos";
  }
  if (params.scopes.length === 0) {
    errors.scopes = "Selecione ao menos um escopo";
  }
  return errors;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through to fallback */ }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function EmbedPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [allowedOrigin, setAllowedOrigin] = useState("https://");
  const [cartRef, setCartRef] = useState("");
  const [ttl, setTtl] = useState(900);
  const [session, setSession] = useState<EmbedSessionResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(EMBED_SCOPES);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  async function issue() {
    const errors = validateEmbedForm({ allowedOrigin, cartRef, ttl, scopes: selectedScopes });
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setMessage(null);
    try {
      setSession(await api.createEmbedSession({
        ttl_seconds: ttl,
        allowed_origin: allowedOrigin,
        cart_ref: cartRef,
        scopes: selectedScopes
      }));
      setMessage("Token gerado com sucesso.");
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    void copyToClipboard(snippet).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }

  const snippet = session
    ? `<script src="${props.apiBaseUrl}/widget/aacp.js"\n  data-aacp-token="${session.embed_session_token}"\n  async>\n</script>`
    : `<script src="${props.apiBaseUrl}/widget/aacp.js"\n  data-aacp-token="EMBED_SESSION_TOKEN"\n  async>\n</script>`;

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <div className="empty-state">
          <div className="empty-state-icon"><KeyRound size={22} /></div>
          <h3>Autenticação necessária</h3>
          <p>Faça login para gerar tokens de sessão e instalar o widget no seu site.</p>
        </div>
      </div>
    );
  }

  const hasToken = Boolean(session);

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Integração</span>
          <h1>Instale o widget no seu site em minutos</h1>
          <p className="page-lead">
            Gere tokens seguros para autenticar sessões do checkout no seu storefront.
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void issue()}>
          <KeyRound size={15} />
          {busy ? "Gerando…" : "Gerar token"}
        </button>
      </header>

      {message && (
        <div
          className={`${session ? "panel-info" : "panel-warn"} embed-feedback`}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      )}

      <div className="split-panel">
        {/* Left — form */}
        <div className="split-panel-controls">
          <section className="panel stacked">
            <div className="panel-title">
              <div>
                <Shield size={16} className="icon-brand" />
                <h2>Configuração do token</h2>
              </div>
              {hasToken && (
                <span className="badge ok">
                  <CheckCircle2 size={11} />
                  Ativo
                </span>
              )}
            </div>

            <label htmlFor="embed-origin">
              Domínio do seu site
              <span className="field-hint">Endereço onde o widget será exibido</span>
              <input
                id="embed-origin"
                type="url"
                value={allowedOrigin}
                placeholder="https://minha-loja.com"
                onChange={(e) => setAllowedOrigin(e.target.value)}
                aria-describedby={validationErrors.allowedOrigin ? "embed-origin-error" : undefined}
              />
              {validationErrors.allowedOrigin && (
                <span className="field-error" id="embed-origin-error" role="alert">
                  {validationErrors.allowedOrigin}
                </span>
              )}
            </label>

            <label htmlFor="embed-cart-ref">
              Identificador do carrinho
              <span className="field-hint">Referência única do carrinho do comprador</span>
              <input
                id="embed-cart-ref"
                value={cartRef}
                placeholder="cart_abc123"
                onChange={(e) => setCartRef(e.target.value)}
                aria-describedby={validationErrors.cartRef ? "embed-cart-ref-error" : undefined}
              />
              {validationErrors.cartRef && (
                <span className="field-error" id="embed-cart-ref-error" role="alert">
                  {validationErrors.cartRef}
                </span>
              )}
            </label>

            <label htmlFor="embed-ttl">
              Duração do token
              <span className="field-hint">Tempo que o comprador pode usar a sessão</span>
              <input
                id="embed-ttl"
                type="number"
                min={60}
                max={86400}
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
                aria-describedby={validationErrors.ttl ? "embed-ttl-error" : "embed-ttl-hint"}
              />
              <span className="field-hint" id="embed-ttl-hint">
                {Math.round(ttl / 60)} min — máximo 24 horas
              </span>
              {validationErrors.ttl && (
                <span className="field-error" id="embed-ttl-error" role="alert">
                  {validationErrors.ttl}
                </span>
              )}
            </label>

            {session && (
              <div className="embed-token-active">
                <span className="token-label">Token ativo</span>
                <code className="token-value" aria-label="Token de embed ativo">
                  {session.embed_session_token.slice(0, 40)}…
                </code>
                <span className="token-expiry">
                  {formatExpiry(session.expires_at_unix)}
                </span>
              </div>
            )}
          </section>

          <section className="panel stacked">
            <div className="panel-title">
              <div>
                <Code2 size={16} className="icon-brand" />
                <h2>Permissões do widget</h2>
              </div>
              <span className="badge muted">{selectedScopes.length} ativas</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 var(--space-3)" }}>
              Escolha o que o widget pode fazer durante a sessão do comprador.
            </p>
            <div className="list">
              {EMBED_SCOPES.map((scope) => {
                const meta = SCOPE_META[scope];
                const isSelected = selectedScopes.includes(scope);
                return (
                  <article key={scope} className="scope-item">
                    <input
                      type="checkbox"
                      className="scope-checkbox"
                      id={`scope-${scope}`}
                      checked={isSelected}
                      onChange={() => {
                        setSelectedScopes((prev) =>
                          isSelected ? prev.filter((s) => s !== scope) : [...prev, scope]
                        );
                      }}
                      aria-label={scope}
                    />
                    <span className={`status-dot ${meta?.ok ? "green" : "amber"}`} aria-hidden="true" />
                    <div>
                      <strong className="scope-name">{meta?.label ?? scope}</strong>
                      {meta && <span className="scope-description">{meta.description}</span>}
                    </div>
                    <span className={`badge ${meta?.ok ? "ok" : "warn"}`}>
                      {meta?.ok ? "leitura" : "escrita"}
                    </span>
                  </article>
                );
              })}
            </div>
            {validationErrors.scopes && (
              <span className="field-error" role="alert">
                {validationErrors.scopes}
              </span>
            )}
          </section>
        </div>

        {/* Right — snippet */}
        <div className="split-panel-preview">
          <div className="developer-code">
            <div className="panel-title">
              <span>
                <Terminal size={13} />
                Código de instalação
              </span>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copiar código de instalação"
              >
                {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <pre className="code-block" aria-label="Código de integração do widget">
              <code>{snippet}</code>
            </pre>

            {!hasToken && (
              <div className="embed-code-empty">
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <KeyRound size={20} />
                  </div>
                  <h3>Aguardando token</h3>
                  <p>
                    Configure os campos ao lado e clique em "Gerar token" para obter o código pronto para uso.
                  </p>
                </div>
              </div>
            )}

            {hasToken && (
              <div className="embed-code-footer">
                <div className="status-line">
                  <span className="status-dot green" aria-hidden="true" />
                  <span>Token incorporado — pronto para produção</span>
                </div>
              </div>
            )}
          </div>

          <div className="panel-info">
            <strong>Como instalar</strong>
            Cole este código no <code>&lt;head&gt;</code> ou antes do <code>&lt;/body&gt;</code> do seu site. O widget aparece automaticamente para o comprador.
          </div>
        </div>
      </div>
    </div>
  );
}
