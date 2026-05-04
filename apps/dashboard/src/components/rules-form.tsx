import React from "react";
import type { MerchantRules } from "@aacp/shared-types";

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
