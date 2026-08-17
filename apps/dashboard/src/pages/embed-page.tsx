import React from "react";
import { CheckCircle2, Code2, Copy, KeyRound, Shield, Zap } from "lucide-react";
import { TabBar } from "../components/TabBar.js";
import { type MerchantProfile } from "../api-client.js";
import { useEmbedPage, formatExpiry } from "./useEmbedPage.js";

const TABS = [
  { key: "install", label: "Instalação" },
  { key: "config", label: "Configuração" },
];

// ── View ────────────────────────────────────────────────────────────────────

export function EmbedPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useEmbedPage(props.apiBaseUrl);

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <div className="empty-state">
          <div className="empty-state-icon"><KeyRound size={22} /></div>
          <h3>Autenticação necessária</h3>
          <p>Faça login para instalar o widget no seu site.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <h1>Instalação do Widget</h1>
          <p className="page-lead">
            Adicione o agente de checkout ao seu site. Ele aparece como um chat flutuante e ajuda seus clientes a finalizarem compras.
          </p>
        </div>
      </header>

      <TabBar tabs={TABS} activeTab={vm.tab} onTabChange={(k) => vm.actions.setTab(k as "install" | "config")} />

      <div style={{ marginTop: "var(--space-5)" }}>
        {vm.tab === "install" && (
          <InstallTab
            snippet={vm.snippet}
            hasToken={vm.hasToken}
            copied={vm.copied}
            onCopy={vm.actions.copySnippet}
          />
        )}
        {vm.tab === "config" && (
          <ConfigTab
            allowedOrigin={vm.allowedOrigin}
            setAllowedOrigin={vm.actions.setAllowedOrigin}
            cartRef={vm.cartRef}
            setCartRef={vm.actions.setCartRef}
            ttl={vm.ttl}
            setTtl={vm.actions.setTtl}
            session={vm.session}
            message={vm.message}
            busy={vm.busy}
            validationErrors={vm.validationErrors}
            onGenerate={vm.actions.generateToken}
          />
        )}
      </div>
    </div>
  );
}

// ── Tab: Instalação ─────────────────────────────────────────────────────────

function InstallTab(props: {
  snippet: string;
  hasToken: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <>
      <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
        <div className="panel-title">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Zap size={16} style={{ color: "var(--color-brand)" }} />
            <span>Como funciona</span>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "12px 0 0" }}>
          Cole o código abaixo no HTML do seu site, antes do <code>&lt;/body&gt;</code>.
          O widget carrega automaticamente e aparece como um botão flutuante no canto inferior direito.
          Seus clientes podem iniciar uma conversa com o agente, tirar dúvidas, aplicar cupons e finalizar a compra sem sair da página.
        </p>
      </div>

      <div className="panel">
        <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Code2 size={16} style={{ color: "var(--color-brand)" }} />
            <span>Código de instalação</span>
          </div>
          <button type="button" className="btn-secondary" onClick={props.onCopy} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            {props.copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            {props.copied ? "Copiado!" : "Copiar código"}
          </button>
        </div>

        <pre className="embed-code-block">
          <code>{props.snippet}</code>
        </pre>

        {!props.hasToken && (
          <p className="field-hint" style={{ marginTop: "var(--space-3)" }}>
            <KeyRound size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Para ativar em produção, gere um token na aba <strong>Token avançado</strong>.
          </p>
        )}

        {props.hasToken && (
          <div className="panel-info" style={{ marginTop: "var(--space-3)", display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={14} />
            Token ativo incorporado no código — pronto para produção.
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: "var(--space-4)" }}>
        <div className="panel-title">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Shield size={16} style={{ color: "var(--color-brand)" }} />
            <span>Plataformas compatíveis</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)", marginTop: 12 }}>
          {[
            { name: "Shopify", hint: "Cole no theme.liquid, antes do </body>" },
            { name: "Nuvemshop", hint: "Configurações → Códigos externos → Rodapé" },
            { name: "WordPress / Woo", hint: "Aparência → Editor → footer.php" },
            { name: "HTML customizado", hint: "Cole em qualquer página HTML" },
          ].map((p) => (
            <div key={p.name} style={{ padding: "12px 16px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--card)" }}>
              <strong style={{ fontSize: 13, display: "block", marginBottom: 2 }}>{p.name}</strong>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{p.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Tab: Configuração ───────────────────────────────────────────────────────

function ConfigTab(props: {
  allowedOrigin: string;
  setAllowedOrigin: (v: string) => void;
  cartRef: string;
  setCartRef: (v: string) => void;
  ttl: number;
  setTtl: (v: number) => void;
  session: import("../api-client.js").EmbedSessionResponse | null;
  message: string | null;
  busy: boolean;
  validationErrors: Record<string, string>;
  onGenerate: () => void;
}) {
  const { session, message, busy, validationErrors } = props;

  return (
    <>
      {message && (
        <div className={session ? "panel-info" : "panel-warn"} role="status" aria-live="polite" style={{ marginBottom: "var(--space-4)" }}>
          {message}
        </div>
      )}

      <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
        <div className="panel-title">
          <span>Domínio e sessão</span>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 16px", lineHeight: 1.5 }}>
          Configure onde o widget será exibido e por quanto tempo cada sessão de checkout permanece ativa.
        </p>

        <div className="embed-config-grid">
          <div className="embed-config-field">
            <label htmlFor="cfg-origin" className="field-label">Domínio permitido</label>
            <input
              id="cfg-origin"
              type="url"
              value={props.allowedOrigin}
              placeholder="https://minha-loja.com.br"
              onChange={(e) => props.setAllowedOrigin(e.target.value)}
            />
            <span className="field-hint">URL do site onde o widget vai aparecer</span>
            {validationErrors.allowedOrigin && <span className="field-error" role="alert">{validationErrors.allowedOrigin}</span>}
          </div>

          <div className="embed-config-field">
            <label htmlFor="cfg-cart" className="field-label">Referência do carrinho</label>
            <input
              id="cfg-cart"
              value={props.cartRef}
              placeholder="cart_abc123"
              onChange={(e) => props.setCartRef(e.target.value)}
            />
            <span className="field-hint">ID único da compra no seu sistema</span>
            {validationErrors.cartRef && <span className="field-error" role="alert">{validationErrors.cartRef}</span>}
          </div>

          <div className="embed-config-field">
            <label htmlFor="cfg-ttl" className="field-label">Validade da sessão</label>
            <select
              id="cfg-ttl"
              value={props.ttl}
              onChange={(e) => props.setTtl(Number(e.target.value))}
            >
              <option value={3600}>1 hora</option>
              <option value={86400}>1 dia</option>
              <option value={604800}>1 semana</option>
              <option value={2592000}>1 mês</option>
              <option value={31536000}>1 ano</option>
              <option value={0}>Nunca expira</option>
            </select>
            <span className="field-hint">Quanto tempo o token fica ativo</span>
            {validationErrors.ttl && <span className="field-error" role="alert">{validationErrors.ttl}</span>}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Token de produção</span>
          {session && <span className="badge ok">Ativo</span>}
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 16px", lineHeight: 1.5 }}>
          Gere o token que autentica o widget no domínio configurado acima. Sem token, o widget funciona apenas em modo de preview.
        </p>

        <button type="button" className="btn-primary" disabled={busy} onClick={props.onGenerate}>
          <KeyRound size={15} />
          {busy ? "Gerando…" : "Gerar token"}
        </button>

        {session && (
          <div className="embed-token-result">
            <CheckCircle2 size={14} style={{ color: "var(--color-success)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <code className="embed-token-value">{session.embed_session_token.slice(0, 56)}…</code>
              <span className="embed-token-expiry">{formatExpiry(session.expires_at_unix)}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
