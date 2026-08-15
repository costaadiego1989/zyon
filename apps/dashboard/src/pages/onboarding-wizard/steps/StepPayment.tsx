import React from "react";
import type { PaymentDraft } from "../useOnboardingWizard.js";
import { isValidEvmAddress } from "../useOnboardingWizard.js";

type StepPaymentProps = {
  paymentDraft: PaymentDraft;
  setPaymentDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  busy: boolean;
  initiateStripeOnboarding: () => void;
  initiateAsaasOnboarding: () => void;
};

export function StepPayment({
  paymentDraft,
  setPaymentDraft,
  fieldErrors,
  setFieldErrors,
  busy,
  initiateStripeOnboarding,
  initiateAsaasOnboarding,
}: StepPaymentProps) {
  return (
    <div className="onb-fields">
      <div className="onb-section-label" style={{ marginBottom: "var(--space-2)", fontSize: "13px", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: "0.02em" }}>Como você vai receber pagamentos</div>

      <div className="onb-field" style={{ padding: "var(--space-4)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: "14px", color: "var(--color-text)" }}>Stripe Connect</strong>
            <span style={{ fontSize: "11px", marginLeft: 8, padding: "2px 6px", borderRadius: "3px", background: paymentDraft.stripeStatus === "active" ? "var(--color-success-bg)" : "var(--color-border)", color: paymentDraft.stripeStatus === "active" ? "var(--color-success)" : "var(--color-text-muted)" }}>
              {paymentDraft.stripeStatus === "active" ? "Ativo" : "Não configurado"}
            </span>
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "4px 0 0" }}>Cartão de crédito e débito internacionais</p>
          </div>
          <button type="button" className="onb-cta onb-cta-inline" disabled={busy || paymentDraft.stripeStatus === "active"} style={{ height: 36, padding: "0 16px", fontSize: "12px" }} onClick={() => void initiateStripeOnboarding()}>
            {paymentDraft.stripeStatus === "active" ? "Ativo" : "Configurar"}
          </button>
        </div>
      </div>

      <div className="onb-field" style={{ padding: "var(--space-4)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: "14px", color: "var(--color-text)" }}>Asaas (PIX e Boleto)</strong>
            <span style={{ fontSize: "11px", marginLeft: 8, padding: "2px 6px", borderRadius: "3px", background: paymentDraft.asaasStatus === "active" ? "var(--color-success-bg)" : "var(--color-border)", color: paymentDraft.asaasStatus === "active" ? "var(--color-success)" : "var(--color-text-muted)" }}>
              {paymentDraft.asaasStatus === "active" ? "Ativo" : paymentDraft.asaasStatus === "pending" ? "Pendente" : "Não configurado"}
            </span>
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "4px 0 0" }}>PIX e boleto para clientes brasileiros. Subconta criada automaticamente.</p>
          </div>
          <button type="button" className="onb-cta onb-cta-inline" disabled={busy || paymentDraft.asaasStatus === "active"} style={{ height: 36, padding: "0 16px", fontSize: "12px" }} onClick={() => void initiateAsaasOnboarding()}>
            {paymentDraft.asaasStatus === "testing" ? "Conectando..." : paymentDraft.asaasStatus === "active" ? "Ativo" : "Conectar"}
          </button>
        </div>
        {paymentDraft.asaasStatus === "active" && <span style={{ fontSize: "12px", color: "var(--color-success)", marginTop: "4px", display: "block" }}>✓ Subconta Asaas ativa</span>}
      </div>

      <label className="onb-switch">
        <span className="onb-switch-text">
          <strong>Aceitar pagamentos em Crypto</strong>
          <span>Stablecoins (USDC) em Polygon ou Base</span>
        </span>
        <input
          type="checkbox"
          checked={paymentDraft.cryptoEnabled}
          onChange={(e) => setPaymentDraft((d) => ({ ...d, cryptoEnabled: e.target.checked }))}
        />
        <span className="onb-switch-track" aria-hidden="true" />
      </label>

      {paymentDraft.cryptoEnabled && (
        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-wallet">Endereço da Wallet (EVM)</label>
          <input
            id="onb-wallet"
            type="text"
            placeholder="0x..."
            value={paymentDraft.walletAddress}
            onChange={(e) => {
              const sanitized = e.target.value.trim();
              setPaymentDraft((d) => ({ ...d, walletAddress: sanitized }));
              if (fieldErrors.walletAddress) setFieldErrors((prev: Record<string, string>) => {
                const next = { ...prev };
                delete next.walletAddress;
                return next;
              });
            }}
            style={{ padding: "8px 12px", borderRadius: "6px", border: fieldErrors.walletAddress ? "1px solid var(--color-error)" : "1px solid var(--color-border)", background: "var(--color-surface-raised)", fontSize: "13px", width: "100%" }}
          />
          <p className="onb-field-help">Carteira EVM válida (42 caracteres, começando com 0x)</p>
          {fieldErrors.walletAddress && <span className="onb-field-error">{fieldErrors.walletAddress}</span>}
          {paymentDraft.walletAddress && !isValidEvmAddress(paymentDraft.walletAddress) && <span style={{ fontSize: "12px", color: "var(--color-error)", marginTop: "4px", display: "block" }}>Endereço inválido</span>}
        </div>
      )}

      <p style={{ fontSize: "12px", color: "var(--color-text-muted)", padding: "var(--space-3)", background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", marginTop: "var(--space-3)", border: "1px dashed var(--color-border)" }}>
        Configure pelo menos um método de pagamento para continuar. Você pode adicionar mais métodos depois.
      </p>
    </div>
  );
}
