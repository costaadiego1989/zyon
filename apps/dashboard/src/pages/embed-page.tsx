import React from "react";
import { CheckCircle2, Code2, Copy, KeyRound, Shield, Zap } from "lucide-react";
import { type MerchantProfile } from "../api-client.js";
import { SectionHeader } from "../components/SectionHeader.js";
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
          <span className="eyebrow">Checkout</span>
          <h1>Embed</h1>
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
        <SectionHeader title="Como funciona" subtitle="Cole o código abaixo no HTML do seu site, antes do &lt;/body&gt;. O widget carrega automaticamente." />
      </div>

      <div className="panel">
        <SectionHeader title="Código de instalação" variant="secondary" trailing={
          <button type="button" className="btn-secondary" onClick={props.onCopy} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            {props.copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            {props.copied ? "Copiado!" : "Copiar código"}
          </button>
        } />

        <pre className="embed-code-block">
          <code>{props.snippet}</code>
        </pre>

        {!props.hasToken && (
          <p className="field-hint" style={{ marginTop: "var(--space-3)" }}>
            <KeyRound size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Para ativar em produção, gere uma chave API em <strong>Desenvolvedores</strong>.
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
        <SectionHeader title="Integrações nativas" subtitle="Use um plugin nativo — configura tudo automaticamente, sem código." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)" }}>
          {[
            { name: "WooCommerce", hint: "Plugin WordPress — instale e ative", status: "disponível" },
            { name: "Magento", hint: "Módulo via Composer", status: "disponível" },
            { name: "VTEX", hint: "App no VTEX IO", status: "em breve" },
            { name: "HTML customizado", hint: "Cole o snippet acima no seu site", status: "manual" },
          ].map((p) => (
            <div key={p.name} style={{ padding: "14px 16px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ fontSize: 13 }}>{p.name}</strong>
                {p.status === "em breve" && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "var(--color-border)", color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase" }}>Em breve</span>}
                {p.status === "disponível" && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "color-mix(in srgb, var(--color-brand) 15%, transparent)", color: "var(--color-brand)", fontWeight: 600, textTransform: "uppercase" }}>Ativo</span>}
              </div>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.4 }}>{p.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

