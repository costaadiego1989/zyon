import React, { useEffect, useState } from "react";
import type { MarketplaceConfig } from "../types.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { FormField } from "../../../components/FormField.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { Button } from "../../../components/Button.js";
import { BlockedMerchantForm } from "./BlockedMerchantForm.js";

type Props = {
  config: MarketplaceConfig;
  saving: boolean;
  saveConfig: (updates: Partial<MarketplaceConfig>) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
};
const values = (config: MarketplaceConfig) => ({
  commission_percent: String(config.commission_percent),
  return_window_days: String(config.return_window_days),
  settlement_window_days: String(config.settlement_window_days),
  chargeback_window_days: String(config.chargeback_window_days),
});
const fields = [
  {
    key: "commission_percent",
    label: "Comissão (%)",
    min: 1,
    max: 50,
    hint: "De 1% a 50%. Em uma venda de R$ 100, 10% corresponde a R$ 10 de comissão.",
  },
  {
    key: "return_window_days",
    label: "Prazo de devolução (dias)",
    min: 1,
    max: 30,
    hint: "De 1 a 30 dias. Este período participa do cálculo da liberação do repasse.",
  },
  {
    key: "settlement_window_days",
    label: "Prazo de repasse (dias)",
    min: 1,
    max: 30,
    hint: "De 1 a 30 dias. Confira o estado de cada pagamento na aba Repasses.",
  },
  {
    key: "chargeback_window_days",
    label: "Prazo de contestação (dias)",
    min: 7,
    max: 30,
    hint: "De 7 a 30 dias. Acompanhe possíveis débitos na aba Contestações.",
  },
] as const;
export function MarketplaceSettings({ config, saving, saveConfig, onDirtyChange }: Props) {
  const [draft, setDraft] = useState(values(config));
  const [enabled, setEnabled] = useState(config.enabled);
  const [blocked, setBlocked] = useState(config.blocked_merchant_ids);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    setDraft(values(config));
    setEnabled(config.enabled);
    setBlocked(config.blocked_merchant_ids);
    setAttempted(false);
  }, [config]);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(values(config)) ||
    enabled !== config.enabled ||
    JSON.stringify(blocked) !== JSON.stringify(config.blocked_merchant_ids);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const invalid = (field: (typeof fields)[number]) =>
    !draft[field.key].trim() ||
    !Number.isFinite(Number(draft[field.key])) ||
    !Number.isInteger(Number(draft[field.key])) ||
    Number(draft[field.key]) < field.min ||
    Number(draft[field.key]) > field.max;
  const save = async () => {
    setAttempted(true);
    if (fields.some(invalid)) return;
    await saveConfig({
      enabled,
      blocked_merchant_ids: blocked,
      commission_percent: Number(draft.commission_percent),
      return_window_days: Number(draft.return_window_days),
      settlement_window_days: Number(draft.settlement_window_days),
      chargeback_window_days: Number(draft.chargeback_window_days),
    });
  };
  const reset = () => {
    setDraft(values(config));
    setEnabled(config.enabled);
    setBlocked(config.blocked_merchant_ids);
    setAttempted(false);
  };
  return (
    <div className="marketplace-page__settings configuration-form">
      <section className="panel">
        <SectionHeader
          title="Participação no marketplace"
          subtitle="Revise as condições antes de salvar. Todas as alterações desta tela são aplicadas juntas."
        />
        <div className="marketplace-enable">
          <ToggleSwitch id="marketplace-enabled" checked={enabled} onChange={setEnabled} disabled={saving} />
          <div className="marketplace-enable__content">
            <label htmlFor="marketplace-enabled" className="marketplace-enable__label">
              Permitir vendas entre lojas parceiras
            </label>
            <p className="marketplace-enable__description">
              Habilite a participação para configurar a operação com parceiros.
            </p>
            <span className="marketplace-saved-state">
              Estado salvo: {config.enabled ? "ativo" : "inativo"}
            </span>
          </div>
        </div>
      </section>
      <section className="panel">
        <SectionHeader
          title="Comissão e prazos"
          subtitle="Preencha os quatro campos e salve quando terminar a revisão."
        />
        <div className="marketplace-settings-grid">
          {fields.map((field) => (
            <FormField
              key={field.key}
              label={field.label}
              type="number"
              value={draft[field.key]}
              onChange={(value) => setDraft((prev) => ({ ...prev, [field.key]: value }))}
              disabled={saving}
              hint={field.hint}
              error={
                attempted && invalid(field)
                  ? `Informe um número ${field.key === "commission_percent" ? "" : "inteiro "}entre ${
                      field.min
                    } e ${field.max}.`
                  : undefined
              }
              inputProps={{
                min: field.min,
                max: field.max,
                step: 1,
              }}
            />
          ))}
        </div>
      </section>
      <section className="panel">
        <SectionHeader
          title="Lojas bloqueadas"
          subtitle="Informe o código das lojas que não devem participar das vendas na sua loja. O bloqueio será aplicado ao salvar."
        />
        <BlockedMerchantForm
          blockedIds={blocked}
          saving={saving}
          onAdd={(id) => setBlocked((prev) => [...prev, id])}
          onRemove={(id) => setBlocked((prev) => prev.filter((value) => value !== id))}
        />
      </section>
      <div className="marketplace-save-bar">
        <p role="status">{dirty ? "Você tem alterações para salvar." : "Configurações atualizadas."}</p>
        <Button variant="outline" disabled={!dirty || saving} onClick={reset}>
          Descartar alterações
        </Button>
        <Button disabled={!dirty || saving} loading={saving} onClick={() => void save()}>
          Salvar configurações
        </Button>
      </div>
    </div>
  );
}
