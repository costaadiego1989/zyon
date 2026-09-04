import React from "react";
import type { Operation } from "../hooks/useCommerceConnections.js";
import { WOOCOMMERCE_KEY_PATTERN, WOOCOMMERCE_SECRET_PATTERN, MAGENTO_TOKEN_PATTERN } from "../hooks/useApiKeyAuth.js";

export type Provider = "woocommerce" | "magento" | "native";

interface ApiKeyPanelProps {
  provider: Provider;
  isBusy: boolean;
  operation: Operation;
  // WooCommerce
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  onStoreUrlChange: (v: string) => void;
  onConsumerKeyChange: (v: string) => void;
  onConsumerSecretChange: (v: string) => void;
  // Magento
  magentoBaseUrl: string;
  magentoToken: string;
  magentoStoreCode: string;
  onMagentoBaseUrlChange: (v: string) => void;
  onMagentoTokenChange: (v: string) => void;
  onMagentoStoreCodeChange: (v: string) => void;
}

export function ApiKeyPanel({
  provider,
  isBusy,
  storeUrl,
  consumerKey,
  consumerSecret,
  onStoreUrlChange,
  onConsumerKeyChange,
  onConsumerSecretChange,
  magentoBaseUrl,
  magentoToken,
  magentoStoreCode,
  onMagentoBaseUrlChange,
  onMagentoTokenChange,
  onMagentoStoreCodeChange,
}: ApiKeyPanelProps) {
  if (provider === "native") return null;

  return (
    <>
      {/* Store URL — shared by WooCommerce and Magento */}
      <label>
        URL da loja
        <input
          type="url"
          placeholder={provider === "magento" ? "https://magento.minhaloja.com.br" : "https://minhaloja.com.br"}
          value={provider === "magento" ? magentoBaseUrl : storeUrl}
          onChange={(e) => provider === "magento" ? onMagentoBaseUrlChange(e.target.value) : onStoreUrlChange(e.target.value)}
          disabled={isBusy}
          required
        />
      </label>

      {provider === "woocommerce" ? (
        <div className="commerce-credential-row">
          <label>
            Chave do consumidor (Consumer Key)
            <input
              type="password"
              placeholder="ck_..."
              value={consumerKey}
              onChange={(e) => onConsumerKeyChange(e.target.value)}
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
              onChange={(e) => onConsumerSecretChange(e.target.value)}
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
              onChange={(e) => onMagentoTokenChange(e.target.value)}
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
              onChange={(e) => onMagentoStoreCodeChange(e.target.value)}
              disabled={isBusy}
            />
            <small style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Código da store view (geralmente "default")</small>
          </label>
        </div>
      ) : null}
    </>
  );
}
