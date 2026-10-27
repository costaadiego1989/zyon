import React from "react";
import type { IntegrationDraft, PlatformChoice } from "../useOnboardingWizard.js";

type StepIntegrationProps = {
  integrationDraft: IntegrationDraft;
  setIntegrationDraft: React.Dispatch<React.SetStateAction<IntegrationDraft>>;
  generatedApiKey: { id: string; secretKey: string; name: string } | null;
  me: { id: string };
  apiBaseUrl: string;
};

export function StepIntegration({
  integrationDraft,
  setIntegrationDraft,
  generatedApiKey,
  me,
  apiBaseUrl,
}: StepIntegrationProps) {
  return (
    <div className="onb-fields">
      <div className="onb-field">
        <span className="onb-field-label">Onde está sua loja?</span>
        <div className="onb-options">
          {([
            ["native", "Integração Nativa (Embed)", "Checkout completo via snippet JavaScript — sem plataforma"],
            ["woocommerce", "WooCommerce", "Plugin WordPress com instalação automática"],
            ["magento", "Magento / Adobe Commerce", "Integração via REST API headless"],
            ["vtex", "VTEX", "Integração via VTEX IO App"],
          ] as const).map(([value, label, help]) => {
            const selected = integrationDraft.platform === value;
            return (
              <label key={value} className={`onb-option${selected ? " onb-option-on" : ""}`}>
                <input
                  type="radio"
                  name="platform"
                  value={value}
                  checked={selected}
                  onChange={() => setIntegrationDraft((d: IntegrationDraft) => ({ ...d, platform: value as PlatformChoice }))}
                />
                <span className="onb-option-dot" aria-hidden="true" />
                <span className="onb-option-text">
                  <strong>{label}</strong>
                  <span>{help}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {integrationDraft.platform && (
        <div className="onb-field" style={{ marginTop: 12, padding: "16px", background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
          {integrationDraft.platform === "native" ? (
            <>
              <span className="onb-field-label">Snippet de integração</span>
              <p className="onb-field-help" style={{ marginBottom: 10 }}>
                Cole este código no <code>&lt;head&gt;</code> do seu site.
              </p>
              <pre style={{ font: "12px 'IBM Plex Mono', monospace", padding: 12, background: "var(--color-bg)", borderRadius: 6, border: "1px solid var(--color-border)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--color-text-secondary)" }}>{`<script defer src="${apiBaseUrl}/widget/aacp.js"><\/script>\n<zyon-checkout-agent\n  merchant-id="${me.id}"\n  api-key="${generatedApiKey?.secretKey ?? "SUA_API_KEY"}"\n  api-base-url="${apiBaseUrl}"\n><\/zyon-checkout-agent>`}</pre>
            </>
          ) : (
            <>
              <span className="onb-field-label">Instruções de instalação</span>
              <ol style={{ font: "13px var(--font-sans)", color: "var(--color-text-secondary)", lineHeight: 1.7, paddingLeft: 18, margin: "8px 0 0" }}>
                {integrationDraft.platform === "woocommerce" && (<><li>Baixe o plugin Zyon Checkout na aba Plugins do WordPress</li><li>Ative e vá em WooCommerce → Zyon Checkout</li><li>Insira seu Merchant ID e API Key</li></>)}
                {integrationDraft.platform === "magento" && (<><li>Acesse Magento Admin → System → Integrations → Add New</li><li>Configure a URL da API Zyon e ative a integração</li><li>Insira o Access Token gerado na página Conexões de Commerce</li></>)}
                {integrationDraft.platform === "vtex" && (<><li>Instale o app Zyon Checkout via VTEX IO CLI</li><li>Configure Merchant ID e API Key no admin VTEX</li><li>Ative o checkout conversacional na seção de pagamento</li></>)}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
