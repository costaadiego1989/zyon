import React, { useMemo, useState } from "react";
import { CheckCircle2, Code2, Copy, KeyRound, Shield, Terminal } from "lucide-react";
import { createDashboardApi, DashboardHttpError, type EmbedSessionResponse, type MerchantProfile } from "../api-client.js";

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

const SCOPE_META: Record<string, { group: "read" | "write"; label: string; description: string }> = {
  "checkout:start":        { group: "write", label: "Iniciar sessão", description: "Iniciar sessão de checkout" },
  "checkout:track":        { group: "read",  label: "Rastrear progresso", description: "Acompanhar progresso da compra" },
  "checkout:chat":         { group: "read",  label: "Chat do agente", description: "Enviar e receber mensagens" },
  "offers:apply":          { group: "write", label: "Aplicar ofertas", description: "Aplicar ofertas e descontos" },
  "coupons:apply":         { group: "write", label: "Cupons", description: "Resgatar cupons" },
  "payment:intents:create":{ group: "write", label: "Criar pagamentos", description: "Processar pagamentos" },
};

const READ_SCOPES = EMBED_SCOPES.filter((s) => SCOPE_META[s]?.group === "read");
const WRITE_SCOPES = EMBED_SCOPES.filter((s) => SCOPE_META[s]?.group === "write");

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
          <span className="eyebrow">Embed</span>
          <h1>Instale o checkout no seu site</h1>
          <p className="page-lead">
            Três passos: configure a sessão, escolha permissões e cole o snippet.
          </p>
        </div>
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

      {/* ── Step 1: Session config ── */}
      <div className="panel" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>1</div>
          <div>
            <h2 style={{ fontSize: 15, marginBottom: 2 }}>Configurar sessão</h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>Defina origem, carrinho e validade do token</p>
          </div>
          {hasToken && <span className="badge ok" style={{ marginLeft: 'auto' }}><CheckCircle2 size={11} /> Token ativo</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <label htmlFor="embed-origin">
            Domínio permitido
            <input
              id="embed-origin"
              type="url"
              value={allowedOrigin}
              placeholder="https://minha-loja.com"
              onChange={(e) => setAllowedOrigin(e.target.value)}
            />
            {validationErrors.allowedOrigin && <span className="field-error" role="alert">{validationErrors.allowedOrigin}</span>}
          </label>

          <label htmlFor="embed-cart-ref">
            ID do carrinho
            <input
              id="embed-cart-ref"
              value={cartRef}
              placeholder="cart_abc123"
              onChange={(e) => setCartRef(e.target.value)}
            />
            {validationErrors.cartRef && <span className="field-error" role="alert">{validationErrors.cartRef}</span>}
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-4)', marginTop: 'var(--space-4)', alignItems: 'start' }}>
          <label htmlFor="embed-ttl">
            Validade (segundos)
            <input
              id="embed-ttl"
              type="number"
              min={60}
              max={86400}
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
            />
            <span className="field-hint">{Math.round(ttl / 60)} min · 15min para lojas, 1h para server-side</span>
            {validationErrors.ttl && <span className="field-error" role="alert">{validationErrors.ttl}</span>}
          </label>

          <button type="button" className="btn-primary" style={{ height: 40, marginTop: 18, padding: '0 var(--space-6)' }} disabled={busy} onClick={() => void issue()}>
            <KeyRound size={15} />
            {busy ? "Gerando…" : "Gerar token"}
          </button>
        </div>

        {session && (
          <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <CheckCircle2 size={14} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
            <code style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.embed_session_token.slice(0, 48)}…</code>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{formatExpiry(session.expires_at_unix)}</span>
          </div>
        )}
      </div>

      {/* ── Step 2: Permissions ── */}
      <div className="panel" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>2</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 15, marginBottom: 2 }}>Permissões</h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>Menos permissões = mais segurança para o comprador</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="btn-secondary btn-xs" onClick={() => setSelectedScopes([...EMBED_SCOPES])}>Todas</button>
            <button type="button" className="btn-secondary btn-xs" onClick={() => setSelectedScopes([])}>Nenhuma</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          {EMBED_SCOPES.map((scope) => {
            const meta = SCOPE_META[scope];
            const isSelected = selectedScopes.includes(scope);
            return (
              <label
                key={scope}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  border: `1px solid ${isSelected ? 'var(--color-brand)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-sm)',
                  background: isSelected ? 'var(--color-brand-subtle)' : 'var(--color-surface)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => setSelectedScopes((prev) => isSelected ? prev.filter((s) => s !== scope) : [...prev, scope])}
                  style={{ width: 16, height: 16, accentColor: 'var(--color-brand)' }}
                />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13, display: 'block' }}>{meta.label}</strong>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{meta.description}</span>
                </div>
                <span className={`badge ${meta.group === 'read' ? 'ok' : 'warn'}`} style={{ fontSize: 10 }}>{meta.group === 'read' ? 'leitura' : 'escrita'}</span>
              </label>
            );
          })}
        </div>
        {validationErrors.scopes && <span className="field-error" role="alert" style={{ marginTop: 'var(--space-2)' }}>{validationErrors.scopes}</span>}
      </div>

      {/* ── Step 3: Code snippet ── */}
      <div className="panel" style={{ padding: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>3</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 15, marginBottom: 2 }}>Cole no seu HTML</h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>Antes do &lt;/body&gt; — o widget carrega automaticamente</p>
          </div>
          <button type="button" onClick={handleCopy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            {copied ? "Copiado!" : "Copiar"}
          </button>
        </div>

        <pre style={{ background: '#0B0F1A', color: '#e2e8f0', padding: 'var(--space-5)', borderRadius: 'var(--radius-sm)', fontSize: 12, lineHeight: 1.7, overflow: 'auto', margin: 0 }}>
          <code>{snippet}</code>
        </pre>

        {!hasToken && (
          <p style={{ marginTop: 'var(--space-3)', fontSize: 12, color: 'var(--color-text-muted)' }}>
            <KeyRound size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Gere o token acima para ativar o snippet com credenciais reais.
          </p>
        )}

        {hasToken && (
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 12, color: 'var(--color-success)' }}>
            <CheckCircle2 size={13} />
            Token incorporado — pronto para produção
          </div>
        )}
      </div>
    </div>
  );
}
