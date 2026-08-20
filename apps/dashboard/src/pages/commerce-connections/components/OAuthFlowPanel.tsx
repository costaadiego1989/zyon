import React from "react";
import type { MerchantProfile } from "../../../api-client.js";
import type { Operation } from "../hooks/useCommerceConnections.js";

type Provider = "woocommerce" | "magento" | "native";

interface OAuthFlowPanelProps {
  provider: Provider;
  isBusy: boolean;
  operation: Operation;
  apiBaseUrl: string;
  me: MerchantProfile | null;
  domain: string;
  onDomainChange: (v: string) => void;
}

const PROVIDER_DOCS: Record<string, string> = {
  native: "https://docs.zyon.com.br/embed",
  woocommerce: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
  magento: "https://developer.adobe.com/commerce/webapi/rest/",
};

const PROVIDER_LABELS: Record<string, string> = {
  native: "Integração Nativa (Embed)",
  woocommerce: "WooCommerce",
  magento: "Magento / Adobe Commerce",
};

export function OAuthFlowPanel({
  provider,
  isBusy,
  apiBaseUrl,
  me,
  domain,
  onDomainChange,
}: OAuthFlowPanelProps) {
  if (provider !== "native") return null;

  return (
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
          value={domain}
          onChange={(e) => onDomainChange(e.target.value)}
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
<script src="${apiBaseUrl}/widget/aacp.js" async></script>

<!-- 2. Cole onde o checkout deve aparecer -->
<zyon-checkout-agent
  merchant-id="${me?.id ?? 'SEU_MERCHANT_ID'}"
  api-base-url="${apiBaseUrl}"
  embed-session-token="TOKEN_DO_SEU_BACKEND"
></zyon-checkout-agent>`}
        </pre>
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)' }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--fg)' }}>Como gerar o token:</strong> No seu backend, chame <code style={{ fontSize: 10, padding: '1px 4px', borderRadius: 3, background: 'var(--bg)' }}>POST /embed-sessions</code> com sua API key (criada em Desenvolvedores). O token retornado é temporário e deve ser gerado por sessão.
          </p>
        </div>
      </div>

      {/* Documentation link */}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <a
          href={PROVIDER_DOCS[provider]}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500 }}
        >
          Documentação {PROVIDER_LABELS[provider]} ↗
        </a>
      </div>
    </div>
  );
}
