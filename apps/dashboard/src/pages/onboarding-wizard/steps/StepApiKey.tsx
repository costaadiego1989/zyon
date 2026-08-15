import React from "react";

type StepApiKeyProps = {
  me: { id: string };
  generatedApiKey: { id: string; secretKey: string; name: string } | null;
  busy: boolean;
  onGenerateKey: () => Promise<void>;
};

export function StepApiKey({ me, generatedApiKey, busy, onGenerateKey }: StepApiKeyProps) {
  return (
    <div className="onb-fields">
      <div className="onb-field" style={{ padding: 20, background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
        <span className="onb-field-label">Merchant ID</span>
        <pre style={{ font: "13px 'IBM Plex Mono', monospace", padding: 10, background: "var(--color-bg)", borderRadius: 6, border: "1px solid var(--color-border)", color: "var(--color-text)", margin: "8px 0 0", wordBreak: "break-all" }}>{me.id}</pre>
      </div>

      {!generatedApiKey && (
        <div className="onb-field">
          <p className="onb-field-help">Clique em "Gerar API Key" para criar suas credenciais de integração.</p>
          <button type="button" className="onb-cta" disabled={busy} onClick={onGenerateKey} style={{ marginTop: "var(--space-3)", width: "100%" }}>
            <span className="onb-cta-face">
              {busy ? "Gerando..." : "Gerar API Key"}
            </span>
          </button>
        </div>
      )}

      {generatedApiKey && (
        <div className="onb-field" style={{ padding: 20, background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
          <span className="onb-field-label">API Key gerada</span>
          <p className="onb-field-help" style={{ margin: "4px 0 8px" }}>Salve estas credenciais — a API Key não será exibida novamente.</p>
          <pre style={{ font: "12px 'IBM Plex Mono', monospace", padding: 10, background: "var(--color-bg)", borderRadius: 6, border: "1px solid var(--color-brand)", color: "var(--color-brand)", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", overflowWrap: "anywhere" }}>{generatedApiKey.secretKey}</pre>
          <button
            type="button"
            className="onb-cta onb-cta-inline"
            style={{ marginTop: 12 }}
            onClick={() => {
              const content = `Zyon Checkout - Credenciais\n================================\nMerchant ID: ${me.id}\nAPI Key: ${generatedApiKey.secretKey}\n\nGuarde este arquivo em local seguro.\nA API Key não pode ser recuperada após fechar esta tela.`;
              const blob = new Blob([content], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "zyon-credenciais.txt";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <span className="onb-cta-face">Baixar credenciais (.txt)</span>
          </button>
        </div>
      )}
    </div>
  );
}
