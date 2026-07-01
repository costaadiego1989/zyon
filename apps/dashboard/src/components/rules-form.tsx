import React from "react";
import type { MerchantRules } from "@zyon/shared-types";

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
}: {
  rules: MerchantRules;
  onChange: (rules: MerchantRules) => void;
}) {
  function patch(next: Partial<MerchantRules>) {
    onChange({ ...rules, ...next });
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
      <fieldset>
        <legend>Descontos</legend>

        <label>
          Desconto máximo: <strong>{rules.maxDiscountPercent}%</strong>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={rules.maxDiscountPercent}
            onChange={(e) => patch({ maxDiscountPercent: Number(e.target.value) })}
          />
        </label>

        <label>
          Margem mínima: <strong>{rules.minimumMarginPercent}%</strong>
          <input
            type="range"
            min={20}
            max={60}
            step={1}
            value={rules.minimumMarginPercent}
            onChange={(e) => patch({ minimumMarginPercent: Number(e.target.value) })}
          />
        </label>

        <div
          className="panel"
          style={{
            marginTop: 8,
            fontSize: 13,
            background: marginOk ? "var(--color-success-bg, #f0fdf4)" : "var(--color-warn-bg, #fff7ed)",
            borderColor: marginOk ? "var(--color-success, #16a34a)" : "var(--color-warn, #ea580c)",
          }}
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
      </fieldset>

      {/* ── Frete ── */}
      <fieldset>
        <legend>Frete</legend>

        <label className="toggle">
          <input
            type="checkbox"
            checked={rules.allowFreeShipping}
            onChange={(e) => patch({ allowFreeShipping: e.target.checked })}
          />
          Permitir frete grátis
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={rules.allowShippingDiscount}
            onChange={(e) => patch({ allowShippingDiscount: e.target.checked })}
          />
          Permitir desconto parcial no frete
        </label>

        {rules.allowFreeShipping && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={rules.allowStackDiscountAndFreeShipping}
              onChange={(e) => patch({ allowStackDiscountAndFreeShipping: e.target.checked })}
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
        </label>

        <label>
          Desconto parcial máximo no frete: <strong>{rules.maxPartialShippingDiscount}%</strong>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={rules.maxPartialShippingDiscount}
            onChange={(e) => patch({ maxPartialShippingDiscount: Number(e.target.value) })}
          />
        </label>
      </fieldset>

      {/* ── Bônus e Cupons ── */}
      <fieldset>
        <legend>Bônus e Cupons</legend>

        <label className="toggle">
          <input
            type="checkbox"
            checked={rules.allowBonusItem}
            onChange={(e) => patch({ allowBonusItem: e.target.checked })}
          />
          Permitir item bônus como oferta
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={rules.couponBoxEnabled}
            onChange={(e) => patch({ couponBoxEnabled: e.target.checked })}
          />
          Exibir campo de cupom no checkout
        </label>
      </fieldset>

      {/* ── Ofertas ── */}
      <fieldset>
        <legend>Ofertas</legend>

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
      </fieldset>

      {/* ── Identidade do Agente ── */}
      <fieldset>
        <legend>Identidade do Agente</legend>

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
          <span style={{ fontSize: 12, color: "var(--color-muted, #64748b)", marginTop: 4, display: "block" }}>
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
          />
        </label>
      </fieldset>

      {/* ── Pagamento Crypto ── */}
      <fieldset className="rules-crypto">
        <legend>Pagamento crypto (USDC / EVM)</legend>
        <label className="toggle">
          <input
            type="checkbox"
            checked={rules.cryptoPayments?.enabled === true}
            onChange={(e) =>
              patch({
                cryptoPayments: {
                  enabled: e.target.checked,
                  chain: rules.cryptoPayments?.chain ?? "polygon",
                  network: rules.cryptoPayments?.network ?? "testnet",
                  treasuryAddress: rules.cryptoPayments?.treasuryAddress ?? "",
                  token: "USDC",
                  quoteTtlSeconds: rules.cryptoPayments?.quoteTtlSeconds ?? 900,
                  brlPerUsdc: rules.cryptoPayments?.brlPerUsdc ?? 5.5,
                },
              })
            }
          />
          Aceitar pagamento com crypto
        </label>
        <label>
          Rede
          <select
            value={rules.cryptoPayments?.chain ?? "polygon"}
            onChange={(e) =>
              patch({
                cryptoPayments: {
                  ...(rules.cryptoPayments ?? {
                    enabled: false,
                    network: "testnet",
                    treasuryAddress: "",
                    token: "USDC",
                    quoteTtlSeconds: 900,
                    brlPerUsdc: 5.5,
                  }),
                  chain: e.target.value as "polygon" | "base",
                },
              })
            }
          >
            <option value="polygon">Polygon</option>
            <option value="base">Base</option>
          </select>
        </label>
        <label>
          Ambiente
          <select
            value={rules.cryptoPayments?.network ?? "testnet"}
            onChange={(e) =>
              patch({
                cryptoPayments: {
                  ...(rules.cryptoPayments ?? {
                    enabled: false,
                    chain: "polygon",
                    treasuryAddress: "",
                    token: "USDC",
                    quoteTtlSeconds: 900,
                    brlPerUsdc: 5.5,
                  }),
                  network: e.target.value as "mainnet" | "testnet",
                },
              })
            }
          >
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </label>
        <label>
          Endereço treasury (0x...)
          <input
            type="text"
            value={rules.cryptoPayments?.treasuryAddress ?? ""}
            onChange={(e) =>
              patch({
                cryptoPayments: {
                  ...(rules.cryptoPayments ?? {
                    enabled: false,
                    chain: "polygon",
                    network: "testnet",
                    token: "USDC",
                    quoteTtlSeconds: 900,
                    brlPerUsdc: 5.5,
                  }),
                  treasuryAddress: e.target.value,
                },
              })
            }
            placeholder="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
          />
        </label>
        <label>
          Taxa BRL por 1 USDC
          <input
            type="number"
            step={0.01}
            value={rules.cryptoPayments?.brlPerUsdc ?? 5.5}
            onChange={(e) =>
              patch({
                cryptoPayments: {
                  ...(rules.cryptoPayments ?? {
                    enabled: false,
                    chain: "polygon",
                    network: "testnet",
                    treasuryAddress: "",
                    token: "USDC",
                    quoteTtlSeconds: 900,
                  }),
                  brlPerUsdc: Number(e.target.value),
                },
              })
            }
          />
        </label>
        <label>
          TTL da cotação (segundos)
          <input
            type="number"
            step={1}
            value={rules.cryptoPayments?.quoteTtlSeconds ?? 900}
            onChange={(e) =>
              patch({
                cryptoPayments: {
                  ...(rules.cryptoPayments ?? {
                    enabled: false,
                    chain: "polygon",
                    network: "testnet",
                    treasuryAddress: "",
                    token: "USDC",
                    brlPerUsdc: 5.5,
                  }),
                  quoteTtlSeconds: Number(e.target.value),
                },
              })
            }
          />
        </label>
      </fieldset>
    </div>
  );
}
