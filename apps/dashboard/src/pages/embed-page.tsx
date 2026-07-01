import React, { useMemo, useState } from "react";
import { CheckCircle2, Code2, Copy, KeyRound, Shield, Terminal } from "lucide-react";
import { createDashboardApi, DashboardHttpError, type EmbedSessionResponse, type MerchantProfile } from "../api-client.js";

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

const SCOPE_META: Record<string, { ok: boolean; label: string }> = {
  "checkout:start":        { ok: true,  label: "Iniciar sessão de checkout" },
  "checkout:track":        { ok: true,  label: "Rastrear progresso do checkout" },
  "checkout:chat":         { ok: true,  label: "Conversa do agente" },
  "offers:apply":          { ok: true,  label: "Aplicar ofertas aprovadas" },
  "coupons:apply":         { ok: true,  label: "Aplicar cupons" },
  "payment:intents:create":{ ok: false, label: "Criar intenções de pagamento" },
};

export function EmbedPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [allowedOrigin, setAllowedOrigin] = useState("https://store.example");
  const [cartRef, setCartRef] = useState("cart_123");
  const [ttl, setTtl] = useState(900);
  const [session, setSession] = useState<EmbedSessionResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setBusy(true);
    setMessage(null);
    try {
      setSession(await api.createEmbedSession({
        ttl_seconds: ttl,
        allowed_origin: allowedOrigin,
        cart_ref: cartRef,
        scopes: EMBED_SCOPES
      }));
      setMessage("Token emitido com sucesso.");
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function copySnippet() {
    void navigator.clipboard?.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
          <p>Faça login para emitir tokens de embed e configurar integrações.</p>
        </div>
      </div>
    );
  }

  const hasToken = Boolean(session);

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <h1>Token de Embed</h1>
          <p className="page-lead">
            Emita tokens scoped, origin-bound para incorporar o widget no seu storefront.
            Cada token expira em {Math.round(ttl / 60)} min e fica vinculado à origem especificada.
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void issue()}>
          <KeyRound size={15} />
          {busy ? "Emitindo…" : "Emitir token"}
        </button>
      </header>

      {message && (
        <p className={`panel-info ${session ? "panel-info" : "panel-warn"}`} style={{ marginBottom: "var(--space-5)" }}>
          {message}
        </p>
      )}

      <div className="split-panel" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Left — form */}
        <div className="split-panel-controls">
          <section className="panel stacked">
            <div className="panel-title">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Shield size={16} style={{ color: "var(--color-brand)" }} />
                <h2>Parâmetros de emissão</h2>
              </div>
              {hasToken && (
                <span className="badge ok">
                  <CheckCircle2 size={11} style={{ marginRight: 4 }} />
                  Ativo
                </span>
              )}
            </div>

            <label>
              Origem permitida (allowed_origin)
              <input
                type="url"
                value={allowedOrigin}
                placeholder="https://store.example"
                onChange={(e) => setAllowedOrigin(e.target.value)}
              />
            </label>

            <label>
              Referência do carrinho (cart_ref)
              <input
                value={cartRef}
                placeholder="cart_123"
                onChange={(e) => setCartRef(e.target.value)}
              />
            </label>

            <label>
              TTL (segundos)
              <input
                type="number"
                min={60}
                max={86400}
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
              />
              <span style={{ fontSize: 11, color: "var(--color-text-faint)", fontFamily: "var(--font-mono)" }}>
                {Math.round(ttl / 60)} min — máx 24h
              </span>
            </label>

            {session && (
              <div style={{
                padding: "var(--space-3)",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-success-bg)",
                border: "1px solid var(--color-success-border)",
                display: "grid",
                gap: "var(--space-1)"
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#065F46", textTransform: "uppercase", letterSpacing: "0.05em" }}>Token ativo</span>
                <code style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#064E3B", wordBreak: "break-all" }}>
                  {session.embed_session_token.slice(0, 40)}…
                </code>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                  exp: {session.expires_at_unix}
                </span>
              </div>
            )}
          </section>

          <section className="panel stacked">
            <div className="panel-title">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Code2 size={16} style={{ color: "var(--color-brand)" }} />
                <h2>Escopos concedidos</h2>
              </div>
              <span className="badge muted">{EMBED_SCOPES.length} escopos</span>
            </div>
            <div className="list" style={{ gap: "var(--space-1)" }}>
              {EMBED_SCOPES.map((scope) => {
                const meta = SCOPE_META[scope];
                return (
                  <article key={scope} style={{ gridTemplateColumns: "auto 1fr auto", gap: "var(--space-3)", padding: "10px var(--space-3)" }}>
                    <span className={`status-dot ${meta?.ok ? "green" : "amber"}`} style={{ marginTop: 2 }} />
                    <div>
                      <strong style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--color-text)" }}>{scope}</strong>
                      {meta && <span style={{ display: "block", fontSize: 11, color: "var(--color-text-muted)", fontWeight: 400 }}>{meta.label}</span>}
                    </div>
                    <span className={`badge ${meta?.ok ? "ok" : "warn"}`} style={{ alignSelf: "center" }}>
                      {meta?.ok ? "read/write" : "write"}
                    </span>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right — snippet */}
        <div className="split-panel-preview">
          <div className="developer-code" style={{ borderRadius: "var(--radius-md)" }}>
            <div className="panel-title" style={{ padding: "var(--space-3) var(--space-4)", background: "#0F172A", borderRadius: "var(--radius-md) var(--radius-md) 0 0" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "#CBD5E1", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                <Terminal size={13} />
                snippet.html
              </span>
              <button
                type="button"
                style={{ minHeight: 28, color: copied ? "#86EFAC" : "#E2E8F0", borderColor: "#334155", background: "#1E293B", fontSize: 12 }}
                onClick={copySnippet}
              >
                {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <pre className="code-block" style={{ minHeight: 180, borderRadius: 0, padding: "var(--space-5)", lineHeight: 1.7 }}>
              <code>{snippet}</code>
            </pre>

            {!hasToken && (
              <div style={{
                padding: "var(--space-4) var(--space-5)",
                borderTop: "1px solid #1E293B",
                background: "#111827"
              }}>
                <div className="empty-state" style={{ padding: "var(--space-5) var(--space-4)", background: "transparent" }}>
                  <div className="empty-state-icon" style={{ background: "#1E293B", borderColor: "#334155", color: "#94A3B8" }}>
                    <KeyRound size={20} />
                  </div>
                  <h3 style={{ color: "#CBD5E1", fontSize: 13 }}>Nenhum token emitido</h3>
                  <p style={{ color: "#64748B", fontSize: 12 }}>
                    Preencha os parâmetros e clique em "Emitir token" para gerar o snippet com o token real.
                  </p>
                </div>
              </div>
            )}

            {hasToken && (
              <div style={{ padding: "var(--space-3) var(--space-5)", borderTop: "1px solid #1E293B", background: "#111827" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <span className="status-dot green" />
                  <span style={{ fontSize: 11, color: "#86EFAC", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                    Token real incorporado — pronto para produção
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="panel-info" style={{ marginTop: "var(--space-4)", fontSize: 12, lineHeight: 1.6 }}>
            <strong style={{ display: "block", marginBottom: 4, fontSize: 12, color: "var(--color-info)" }}>Como usar</strong>
            Cole o snippet no <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>&lt;head&gt;</code> ou antes do <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>&lt;/body&gt;</code> do seu storefront. O widget inicializa automaticamente ao detectar o token.
          </div>
        </div>
      </div>
    </div>
  );
}
