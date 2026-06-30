import React from "react";
import type { MerchantRules } from "@zyon/shared-types";

export function RulesForm({
  rules,
  onChange
}: {
  rules: MerchantRules;
  onChange: (rules: MerchantRules) => void;
}) {
  function patch(next: Partial<MerchantRules>) {
    onChange({ ...rules, ...next });
  }

  return (
    <div className="rules-grid">
      <NumberField label="Desconto maximo %" value={rules.maxDiscountPercent} onChange={(value) => patch({ maxDiscountPercent: value })} />
      <NumberField label="Margem minima %" value={rules.minimumMarginPercent} onChange={(value) => patch({ minimumMarginPercent: value })} />
      <NumberField label="Minimo frete gratis" value={rules.freeShippingMinCartValue} onChange={(value) => patch({ freeShippingMinCartValue: value })} />
      <NumberField label="Subsidio maximo frete" value={rules.maxShippingSubsidy} onChange={(value) => patch({ maxShippingSubsidy: value })} />
      <NumberField label="Frete parcial maximo" value={rules.maxPartialShippingDiscount} onChange={(value) => patch({ maxPartialShippingDiscount: value })} />
      <NumberField label="Expira em minutos" value={rules.offerExpirationMinutes} onChange={(value) => patch({ offerExpirationMinutes: value })} />
      <label className="toggle">
        <input type="checkbox" checked={rules.allowFreeShipping} onChange={(event) => patch({ allowFreeShipping: event.target.checked })} />
        Permitir frete gratis
      </label>
      <label className="toggle">
        <input type="checkbox" checked={rules.allowShippingDiscount} onChange={(event) => patch({ allowShippingDiscount: event.target.checked })} />
        Permitir frete parcial
      </label>
      <label>
        Voz da marca
        <select value={rules.brandVoice} onChange={(event) => patch({ brandVoice: event.target.value as MerchantRules["brandVoice"] })}>
          <option value="consultative">Consultiva</option>
          <option value="aggressive">Agressiva</option>
          <option value="premium">Premium</option>
          <option value="young">Jovem</option>
          <option value="technical">Tecnica</option>
          <option value="popular">Popular</option>
        </select>
      </label>

      <fieldset className="rules-crypto">
        <legend>Pagamento crypto (USDC / EVM)</legend>
        <label className="toggle">
          <input
            type="checkbox"
            checked={rules.cryptoPayments?.enabled === true}
            onChange={(event) =>
              patch({
                cryptoPayments: {
                  enabled: event.target.checked,
                  chain: rules.cryptoPayments?.chain ?? "polygon",
                  network: rules.cryptoPayments?.network ?? "testnet",
                  treasuryAddress: rules.cryptoPayments?.treasuryAddress ?? "",
                  token: "USDC",
                  quoteTtlSeconds: rules.cryptoPayments?.quoteTtlSeconds ?? 900,
                  brlPerUsdc: rules.cryptoPayments?.brlPerUsdc ?? 5.5
                }
              })
            }
          />
          Aceitar pagamento com crypto
        </label>
        <label>
          Rede
          <select
            value={rules.cryptoPayments?.chain ?? "polygon"}
            onChange={(event) =>
              patch({
                cryptoPayments: {
                  ...(rules.cryptoPayments ?? {
                    enabled: false,
                    network: "testnet",
                    treasuryAddress: "",
                    token: "USDC",
                    quoteTtlSeconds: 900,
                    brlPerUsdc: 5.5
                  }),
                  chain: event.target.value as "polygon" | "base"
                }
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
            onChange={(event) =>
              patch({
                cryptoPayments: {
                  ...(rules.cryptoPayments ?? {
                    enabled: false,
                    chain: "polygon",
                    treasuryAddress: "",
                    token: "USDC",
                    quoteTtlSeconds: 900,
                    brlPerUsdc: 5.5
                  }),
                  network: event.target.value as "mainnet" | "testnet"
                }
              })
            }
          >
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </label>
        <label>
          Endereco treasury (0x...)
          <input
            type="text"
            value={rules.cryptoPayments?.treasuryAddress ?? ""}
            onChange={(event) =>
              patch({
                cryptoPayments: {
                  ...(rules.cryptoPayments ?? {
                    enabled: false,
                    chain: "polygon",
                    network: "testnet",
                    token: "USDC",
                    quoteTtlSeconds: 900,
                    brlPerUsdc: 5.5
                  }),
                  treasuryAddress: event.target.value
                }
              })
            }
            placeholder="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
          />
        </label>
        <NumberField
          label="Taxa BRL por 1 USDC"
          value={rules.cryptoPayments?.brlPerUsdc ?? 5.5}
          onChange={(value) =>
            patch({
              cryptoPayments: {
                ...(rules.cryptoPayments ?? {
                  enabled: false,
                  chain: "polygon",
                  network: "testnet",
                  treasuryAddress: "",
                  token: "USDC",
                  quoteTtlSeconds: 900
                }),
                brlPerUsdc: value
              }
            })
          }
        />
        <NumberField
          label="TTL da cotacao (segundos)"
          value={rules.cryptoPayments?.quoteTtlSeconds ?? 900}
          onChange={(value) =>
            patch({
              cryptoPayments: {
                ...(rules.cryptoPayments ?? {
                  enabled: false,
                  chain: "polygon",
                  network: "testnet",
                  treasuryAddress: "",
                  token: "USDC",
                  brlPerUsdc: 5.5
                }),
                quoteTtlSeconds: value
              }
            })
          }
        />
      </fieldset>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
