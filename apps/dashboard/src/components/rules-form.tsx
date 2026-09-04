import React from "react";
import type { MerchantRules } from "@zyon/shared-types";
import { validateOriginZip, validateTreasuryAddress } from "../utils/rules-validation.js";

const BRAND_VOICE_DESC: Record<MerchantRules["brandVoice"], string> = {
  consultative: "Consultiva — tom educativo, foco em valor e benefícios",
  aggressive: "Agressiva — urgência, escassez, CTA direto",
  premium: "Premium — linguagem sofisticada, experiência exclusiva",
  young: "Jovem — descontraída, emojis, linguagem próxima",
  technical: "Técnica — especificações, precisão, dados",
  popular: "Popular — simples, acessível, linguagem do dia a dia",
};

const SAMPLE_PRICE = 100;

export function RulesForm({
  rules,
  onChange,
  validationErrors = {},
  onValidationChange,
}: {
  rules: MerchantRules;
  onChange: (rules: MerchantRules) => void;
  validationErrors?: Record<string, string>;
  onValidationChange?: (errors: Record<string, string>) => void;
}) {
  function patch(next: Partial<MerchantRules>) {
    onChange({ ...rules, ...next });
  }

  function setFieldError(field: string, error: string | null) {
    if (!onValidationChange) return;
    const next = { ...validationErrors };
    if (error) next[field] = error;
    else delete next[field];
    onValidationChange(next);
  }

  function handleOriginZipBlur() {
    const err = validateOriginZip(rules.originZip);
    setFieldError("originZip", err);
  }

  function handleTreasuryAddressBlur() {
    if (!rules.cryptoPayments?.enabled) return;
    const err = validateTreasuryAddress(rules.cryptoPayments?.treasuryAddress);
    setFieldError("treasuryAddress", err);
  }

  const maxDiscountValue = ((SAMPLE_PRICE * rules.maxDiscountPercent) / 100).toFixed(2);
  const priceAfterDiscount = (SAMPLE_PRICE - Number(maxDiscountValue)).toFixed(2);
  const costEstimate = SAMPLE_PRICE * 0.5;
  const paymentFee = Number(priceAfterDiscount) * 0.04;
  const marginValue = Number(priceAfterDiscount) - costEstimate - paymentFee;
  const marginPercent = ((marginValue / SAMPLE_PRICE) * 100).toFixed(1);
  const marginOk = marginValue / SAMPLE_PRICE >= rules.minimumMarginPercent / 100;

  return (
    <div className="rules-grid">
      {/* ── Descontos ── */}
      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="section-header"><h3>Descontos</h3></div>
          <p className="page-lead" style={{ marginBottom: 'var(--space-3)' }}>Limites de desconto que o agente pode oferecer</p>

          <label htmlFor="slider-max-discount">
            Desconto máximo: <strong id="value-max-discount">{rules.maxDiscountPercent}%</strong>
            <input
              id="slider-max-discount"
              type="range"
              min={0}
              max={30}
              step={1}
              value={rules.maxDiscountPercent}
              onChange={(e) => patch({ maxDiscountPercent: Number(e.target.value) })}
              aria-valuemin={0}
              aria-valuemax={30}
              aria-valuenow={rules.maxDiscountPercent}
              aria-valuetext={`${rules.maxDiscountPercent}%`}
              aria-describedby="value-max-discount"
            />
          </label>
          {validationErrors.marginConsistency && (
            <span className="field-error">{validationErrors.marginConsistency}</span>
          )}

          <label htmlFor="slider-min-margin">
            Margem mínima: <strong id="value-min-margin">{rules.minimumMarginPercent}%</strong>
            <input
              id="slider-min-margin"
              type="range"
              min={20}
              max={60}
              step={1}
              value={rules.minimumMarginPercent}
              onChange={(e) => patch({ minimumMarginPercent: Number(e.target.value) })}
              aria-valuemin={20}
              aria-valuemax={60}
              aria-valuenow={rules.minimumMarginPercent}
              aria-valuetext={`${rules.minimumMarginPercent}%`}
              aria-describedby="value-min-margin"
            />
          </label>

          <div
            className={`panel ${marginOk ? "panel-info" : "panel-warn"}`}
          >
            <strong>Simulação — produto R${SAMPLE_PRICE.toFixed(2)}</strong>
            <div>Desconto máximo: R${maxDiscountValue} ({rules.maxDiscountPercent}%)</div>
            <div>Preço final: R${priceAfterDiscount}</div>
            <div>Custo estimado (50%): R${costEstimate.toFixed(2)}</div>
            <div>Taxa pagamento (4%): R${paymentFee.toFixed(2)}</div>
            <div>
              Margem estimada: R${marginValue.toFixed(2)} ({marginPercent}%)
              {" "}
              {marginOk ? "✓ dentro do limite" : "✗ abaixo da margem mínima"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Frete ── */}
      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="section-header"><h3>Frete</h3></div>
          <p className="page-lead" style={{ marginBottom: 'var(--space-3)' }}>Opções de frete grátis e subsídio</p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={rules.allowFreeShipping}
              onChange={(e) => patch({ allowFreeShipping: e.target.checked })}
              role="switch"
              aria-checked={rules.allowFreeShipping}
            />
            Permitir frete grátis
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={rules.allowShippingDiscount}
              onChange={(e) => patch({ allowShippingDiscount: e.target.checked })}
              role="switch"
              aria-checked={rules.allowShippingDiscount}
            />
            Permitir desconto parcial no frete
          </label>

          {rules.allowFreeShipping && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={rules.allowStackDiscountAndFreeShipping}
                onChange={(e) => patch({ allowStackDiscountAndFreeShipping: e.target.checked })}
                role="switch"
                aria-checked={rules.allowStackDiscountAndFreeShipping}
              />
              Permitir desconto + frete grátis combinados
            </label>
          )}

          <label>
            Valor mínimo carrinho para frete grátis (R$)
            <input
              type="number"
              min={0}
              step={1}
              value={rules.freeShippingMinCartValue}
              onChange={(e) => patch({ freeShippingMinCartValue: Number(e.target.value) })}
            />
            {validationErrors.freeShippingMinCartValue && (
              <span className="field-error">{validationErrors.freeShippingMinCartValue}</span>
            )}
          </label>

          <label>
            Subsídio máximo de frete (R$)
            <input
              type="number"
              min={0}
              step={1}
              value={rules.maxShippingSubsidy}
              onChange={(e) => patch({ maxShippingSubsidy: Number(e.target.value) })}
            />
            {validationErrors.maxShippingSubsidy && (
              <span className="field-error">{validationErrors.maxShippingSubsidy}</span>
            )}
          </label>

          <label htmlFor="slider-partial-shipping">
            Desconto parcial máximo no frete: <strong id="value-partial-shipping">{rules.maxPartialShippingDiscount}%</strong>
            <input
              id="slider-partial-shipping"
              type="range"
              min={0}
              max={100}
              step={5}
              value={rules.maxPartialShippingDiscount}
              onChange={(e) => patch({ maxPartialShippingDiscount: Number(e.target.value) })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={rules.maxPartialShippingDiscount}
              aria-valuetext={`${rules.maxPartialShippingDiscount}%`}
              aria-describedby="value-partial-shipping"
            />
          </label>
        </div>
      </div>

      {/* ── Bônus e Cupons ── */}
      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="section-header"><h3>Bônus e Cupons</h3></div>
          <p className="page-lead" style={{ marginBottom: 'var(--space-3)' }}>Ofertas de bônus e campo de cupom</p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={rules.allowBonusItem}
              onChange={(e) => patch({ allowBonusItem: e.target.checked })}
              role="switch"
              aria-checked={rules.allowBonusItem}
            />
            Permitir item bônus como oferta
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={rules.couponBoxEnabled}
              onChange={(e) => patch({ couponBoxEnabled: e.target.checked })}
              role="switch"
              aria-checked={rules.couponBoxEnabled}
            />
            Exibir campo de cupom no checkout
          </label>
        </div>
      </div>

      {/* ── Ofertas ── */}
      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="section-header"><h3>Ofertas</h3></div>
          <p className="page-lead" style={{ marginBottom: 'var(--space-3)' }}>Configuração de expiração de ofertas</p>

          <label>
            Expiração da oferta (minutos)
            <input
              type="number"
              min={5}
              max={60}
              step={1}
              value={rules.offerExpirationMinutes}
              onChange={(e) => patch({ offerExpirationMinutes: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      {/* ── Identidade do Agente ── */}
      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="section-header"><h3>Identidade do Agente</h3></div>
          <p className="page-lead" style={{ marginBottom: 'var(--space-3)' }}>Tom de voz e personalidade do agente</p>

          <label>
            Voz da marca
            <select
              value={rules.brandVoice}
              onChange={(e) => patch({ brandVoice: e.target.value as MerchantRules["brandVoice"] })}
            >
              {(Object.keys(BRAND_VOICE_DESC) as MerchantRules["brandVoice"][]).map((v) => (
                <option key={v} value={v}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </option>
              ))}
            </select>
            <span className="page-lead">
              {BRAND_VOICE_DESC[rules.brandVoice]}
            </span>
          </label>

          <label>
            CEP de origem (cálculo de frete)
            <input
              type="text"
              maxLength={9}
              placeholder="00000-000"
              value={rules.originZip ?? ""}
              onChange={(e) => patch({ originZip: e.target.value || undefined })}
              onBlur={handleOriginZipBlur}
            />
            {validationErrors.originZip && (
              <span className="field-error">{validationErrors.originZip}</span>
            )}
          </label>
        </div>
      </div>

      {/* ── Pagamento Crypto ── */}
      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="section-header"><h3>Pagamento crypto</h3></div>
          <p className="page-lead" style={{ marginBottom: 'var(--space-3)' }}>Pagamento com criptomoeda</p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={rules.cryptoPayments?.enabled === true}
              onChange={(e) =>
                patch({
                  cryptoPayments: {
                    ...rules.cryptoPayments,
                    enabled: e.target.checked,
                    treasuryAddress: rules.cryptoPayments?.treasuryAddress ?? "",
                  } as any,
                })
              }
              role="switch"
              aria-checked={rules.cryptoPayments?.enabled === true}
            />
            Aceitar pagamento com crypto (USDC)
          </label>
          <label>
            Endereço da carteira
            <input
              type="text"
              value={rules.cryptoPayments?.treasuryAddress ?? ""}
              onChange={(e) =>
                patch({
                  cryptoPayments: {
                    ...rules.cryptoPayments,
                    enabled: rules.cryptoPayments?.enabled ?? false,
                    treasuryAddress: e.target.value,
                  } as any,
                })
              }
              onBlur={handleTreasuryAddressBlur}
              placeholder="0x..."
            />
            {validationErrors.treasuryAddress && (
              <span className="field-error">{validationErrors.treasuryAddress}</span>
            )}
          </label>
        </div>
      </div>

      {/* ── Políticas da loja ── */}
      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="section-header"><h3>Políticas da loja</h3></div>
          <p className="page-lead" style={{ marginBottom: 'var(--space-3)' }}>Links exibidos no footer do checkout para o comprador</p>

          <label>
            Política de Privacidade
            <input
              type="url"
              value={rules.policies?.privacyUrl ?? ""}
              onChange={(e) => patch({ policies: { ...rules.policies, privacyUrl: e.target.value } })}
              placeholder="https://suastore.com.br/privacidade"
            />
          </label>
          <label>
            Termos de Uso
            <input
              type="url"
              value={rules.policies?.termsUrl ?? ""}
              onChange={(e) => patch({ policies: { ...rules.policies, termsUrl: e.target.value } })}
              placeholder="https://suastore.com.br/termos"
            />
          </label>
          <label>
            Trocas e Devoluções
            <input
              type="url"
              value={rules.policies?.refundUrl ?? ""}
              onChange={(e) => patch({ policies: { ...rules.policies, refundUrl: e.target.value } })}
              placeholder="https://suastore.com.br/trocas"
            />
          </label>
          <label>
            Frete e Entregas
            <input
              type="url"
              value={rules.policies?.shippingUrl ?? ""}
              onChange={(e) => patch({ policies: { ...rules.policies, shippingUrl: e.target.value } })}
              placeholder="https://suastore.com.br/frete"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
