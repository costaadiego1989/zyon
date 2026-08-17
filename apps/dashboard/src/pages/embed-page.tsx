import React from "react";
import { CheckCircle2, Code2, Copy, KeyRound, Shield, Zap } from "lucide-react";
import { type MerchantProfile } from "../api-client.js";
import { useEmbedPage } from "./useEmbedPage.js";

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

      <div style={{ marginTop: "var(--space-5)" }}>
        <InstallTab
          snippet={vm.snippet}
          hasToken={vm.hasToken}
          copied={vm.copied}
          onCopy={vm.actions.copySnippet}
        />
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

