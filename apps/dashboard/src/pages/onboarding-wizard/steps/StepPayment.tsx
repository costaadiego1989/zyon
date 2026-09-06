import React, { useEffect, useState } from "react";
import type { PaymentDraft } from "../useOnboardingWizard.js";
import { isValidEvmAddress } from "../useOnboardingWizard.js";
import { Button } from "../../../components/Button.js";
import { FormField } from "../../../components/FormField.js";
import { SidePanel } from "../../../components/SidePanel.js";
import { useApi } from "../../../hooks/useApi.js";
import type { CompanyPrefill } from "../../payment-connections/components/AsaasSubaccountForm.js";
import { AsaasConnectionForm, type AsaasConnectionPayload } from "../../payment-connections/components/AsaasConnectionForm.js";

type StepPaymentProps = {
  paymentDraft: PaymentDraft;
  setPaymentDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  busy: boolean;
  message?: string | null;
  initiateStripeOnboarding: () => void;
  initiateAsaasOnboarding: (payload?: AsaasConnectionPayload) => Promise<boolean>;
  initiateMercadoPagoOnboarding: () => void;
};

export function StepPayment({
  paymentDraft,
  setPaymentDraft,
  fieldErrors,
  setFieldErrors,
  busy,
  message,
  initiateStripeOnboarding,
  initiateAsaasOnboarding,
  initiateMercadoPagoOnboarding,
}: StepPaymentProps) {
  const api = useApi();
  const [asaasFormOpen, setAsaasFormOpen] = useState(false);
  const [company, setCompany] = useState<CompanyPrefill | null>(null);
  const [loadingCompany, setLoadingCompany] = useState(false);

  function openAsaasForm() {
    // Do not expose an editable form before the prefill effect replaces it.
    setLoadingCompany(true);
    setAsaasFormOpen(true);
  }

  useEffect(() => {
    if (!asaasFormOpen) return;
    let active = true;
    setLoadingCompany(true);
    void api.getStoreSettings().then(settings => {
      if (active) setCompany((settings?.company as CompanyPrefill) ?? null);
    }).catch(() => { if (active) setCompany(null); }).finally(() => { if (active) setLoadingCompany(false); });
    return () => { active = false; };
  }, [api, asaasFormOpen]);

  return (
    <div className="onb-fields">
      <div className="onb-section-label" style={{ marginBottom: "var(--space-2)", fontSize: "13px", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: "0.02em" }}>Como você vai receber pagamentos</div>

      <div className="onb-field" style={{ padding: "var(--space-4)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: "14px", color: "var(--color-text)" }}>Stripe Connect</strong>
            <span style={{ fontSize: "11px", marginLeft: 8, padding: "2px 6px", borderRadius: "3px", background: paymentDraft.stripeStatus === "active" ? "var(--color-success-bg)" : "var(--color-border)", color: paymentDraft.stripeStatus === "active" ? "var(--color-success)" : "var(--color-text-muted)" }}>
              {paymentDraft.stripeStatus === "active" ? "Ativo" : paymentDraft.stripeStatus === "pending" ? "Pendente" : "Não configurado"}
            </span>
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "4px 0 0" }}>Cartão de crédito e débito internacionais</p>
          </div>
          <Button variant="outline" size="sm" disabled={busy || paymentDraft.stripeStatus === "active"} onClick={() => void initiateStripeOnboarding()}>
            {paymentDraft.stripeStatus === "active" ? "Ativo" : paymentDraft.stripeStatus === "pending" ? "Continuar" : "Configurar"}
          </Button>
        </div>
      </div>

      <div className="onb-field" style={{ padding: "var(--space-4)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: "14px", color: "var(--color-text)" }}>Asaas (PIX e Boleto)</strong>
            <span style={{ fontSize: "11px", marginLeft: 8, padding: "2px 6px", borderRadius: "3px", background: paymentDraft.asaasStatus === "active" ? "var(--color-success-bg)" : "var(--color-border)", color: paymentDraft.asaasStatus === "active" ? "var(--color-success)" : "var(--color-text-muted)" }}>
              {paymentDraft.asaasStatus === "active" ? "Ativo" : paymentDraft.asaasStatus === "pending" ? "Pendente" : "Não configurado"}
            </span>
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "4px 0 0" }}>Conecte o Asaas com os dados da sua loja e acompanhe a ativação.</p>
          </div>
          <Button variant="outline" size="sm" disabled={busy || paymentDraft.asaasStatus === "active"} onClick={() => paymentDraft.asaasStatus === "pending" ? void initiateAsaasOnboarding() : openAsaasForm()}>
            {paymentDraft.asaasStatus === "testing" ? "Conectando..." : paymentDraft.asaasStatus === "active" ? "Ativo" : paymentDraft.asaasStatus === "pending" ? "Continuar" : "Conectar"}
          </Button>
        </div>
        {paymentDraft.asaasStatus === "active" && <span style={{ fontSize: "12px", color: "var(--color-success)", marginTop: "4px", display: "block" }}>✓ Conta Asaas ativa</span>}
      </div>

      <SidePanel isOpen={asaasFormOpen} title="Conectar Asaas" onClose={() => { if (!busy) setAsaasFormOpen(false); }}>
        {message && <p role="status">{message}</p>}
        {loadingCompany ? <p role="status">Carregando dados da loja...</p> : <AsaasConnectionForm
          company={company}
          saving={busy}
          onCancel={() => setAsaasFormOpen(false)}
          onSubmit={payload => { void initiateAsaasOnboarding(payload).then(ok => { if (ok) setAsaasFormOpen(false); }); }}
        />}
      </SidePanel>

      <div className="onb-field" style={{ padding: "var(--space-4)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: "14px", color: "var(--color-text)" }}>Mercado Pago</strong>
            <span style={{ fontSize: "11px", marginLeft: 8, padding: "2px 6px", borderRadius: "3px", background: paymentDraft.mercadopagoStatus === "active" ? "var(--color-success-bg)" : "var(--color-border)", color: paymentDraft.mercadopagoStatus === "active" ? "var(--color-success)" : "var(--color-text-muted)" }}>
              {paymentDraft.mercadopagoStatus === "active" ? "Ativo" : paymentDraft.mercadopagoStatus === "pending" ? "Pendente" : "Não configurado"}
            </span>
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "4px 0 0" }}>Cartão, PIX e boleto via sua conta Mercado Pago.</p>
          </div>
          <Button variant="outline" size="sm" disabled={busy || paymentDraft.mercadopagoStatus === "active"} onClick={() => void initiateMercadoPagoOnboarding()}>
            {paymentDraft.mercadopagoStatus === "connecting" ? "Conectando..." : paymentDraft.mercadopagoStatus === "active" ? "Ativo" : "Conectar"}
          </Button>
        </div>
        {paymentDraft.mercadopagoStatus === "active" && <span style={{ fontSize: "12px", color: "var(--color-success)", marginTop: "4px", display: "block" }}>✓ Mercado Pago conectado</span>}
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
          <FormField
            label="Endereço da Wallet (EVM)"
            type="text"
            placeholder="0x..."
            value={paymentDraft.walletAddress}
            onChange={(value) => {
              const sanitized = value.trim();
              setPaymentDraft((d) => ({ ...d, walletAddress: sanitized }));
              if (fieldErrors.walletAddress) setFieldErrors((prev: Record<string, string>) => {
                const next = { ...prev };
                delete next.walletAddress;
                return next;
              });
            }}
            error={fieldErrors.walletAddress}
            hint="Carteira EVM válida (42 caracteres, começando com 0x)"
          />
          {paymentDraft.walletAddress && !isValidEvmAddress(paymentDraft.walletAddress) && <span style={{ fontSize: "12px", color: "var(--color-error)", marginTop: "4px", display: "block" }}>Endereço inválido</span>}
        </div>
      )}

      <p style={{ fontSize: "12px", color: "var(--color-text-muted)", padding: "var(--space-3)", background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", marginTop: "var(--space-3)", border: "1px dashed var(--color-border)" }}>
        Configure pelo menos um método de pagamento para continuar. Você pode adicionar mais métodos depois.
      </p>
    </div>
  );
}
