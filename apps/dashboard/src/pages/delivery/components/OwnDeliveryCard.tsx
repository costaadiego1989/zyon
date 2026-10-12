import React, { useEffect, useId, useState } from "react";
import { Truck, Plus, Trash2 } from "lucide-react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { Button } from "../../../components/Button.js";
import { Modal } from "../../../components/Modal.js";
import { FormField, FormSelect } from "../../../components/FormField.js";
import { RadiusZonesEditor } from "./RadiusZonesEditor.js";
import type { OwnDeliveryConfig } from "../../../api/endpoints/delivery.js";
import "../../../components/configuration-form.css";
import "../delivery.css";

interface OwnDeliveryCardProps {
  config: OwnDeliveryConfig | undefined;
  saving: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onOpenConfig: () => void;
}
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const displayCents = (cents: number | null) => cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
const parseCents = (value: string) => /^\d+(?:[.,]\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value.replace(",", ".")) * 100) : NaN;

export function OwnDeliveryCard({ config, saving, onToggle, onOpenConfig }: OwnDeliveryCardProps) {
  const switchId = useId();
  const enabled = config?.enabled ?? false;
  const mode = config?.mode ?? "fixed";
  return <div className="delivery-provider">
    <div className="delivery-provider__heading">
      <Truck size={20} aria-hidden="true" />
      <div><h2>Entrega própria</h2><p>Use a equipe da loja ou um entregador local.</p></div>
    </div>
    <div className="delivery-provider__activation">
      <label htmlFor={switchId}>{enabled ? "Entrega própria ativada" : "Ativar entrega própria"}</label>
      <ToggleSwitch id={switchId} checked={enabled} onChange={onToggle} disabled={saving} />
    </div>
    {enabled && config ? <div className="delivery-provider__summary">
      <div><strong>{mode === "fixed" ? money(config.flatPriceCents) : mode === "by_neighborhood" ? `${config.neighborhoods.length} bairros cadastrados` : `${config.radiusZones.filter(z => z.priceCents > 0).length} faixas de distância`}</strong>
        <p>Prazo estimado: {config.estimatedValue} {config.estimatedUnit === "minutes" ? "minutos" : config.estimatedValue === 1 ? "dia" : "dias"}.</p></div>
      <Button variant="outline" disabled={saving} onClick={onOpenConfig}>Configurar</Button>
    </div> : <p className="delivery-provider__hint">Defina a área atendida, os valores e o prazo antes de ativar.</p>}
  </div>;
}
interface OwnDeliveryConfigPanelProps {
  config: OwnDeliveryConfig | undefined;
  saving: boolean;
  onSave: (patch: Partial<OwnDeliveryConfig>) => Promise<void>;
  onClose: () => void;
  originZip?: string;
}
export function OwnDeliveryConfigPanel({ config, saving, onSave, onClose, originZip }: OwnDeliveryConfigPanelProps) {
  const formId = useId();
  const [local, setLocal] = useState<OwnDeliveryConfig>(() => ({
    enabled: true, mode: config?.mode ?? "fixed", flatPriceCents: config?.flatPriceCents ?? 800,
    freeAboveCents: config?.freeAboveCents ?? null, estimatedValue: config?.estimatedValue ?? 60,
    estimatedUnit: config?.estimatedUnit ?? "minutes", neighborhoods: config?.neighborhoods ?? [], radiusZones: config?.radiusZones ?? [],
  }));
  const [flatPrice, setFlatPrice] = useState(() => displayCents(local.flatPriceCents));
  const [freeAbove, setFreeAbove] = useState(() => displayCents(local.freeAboveCents));
  const [estimate, setEstimate] = useState(String(local.estimatedValue));
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  useEffect(() => {
    if (validationAttempt) document.getElementById(formId)?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
  }, [validationAttempt, formId]);
  const close = () => { if (!saving) onClose(); };

  function addNeighborhood() {
    const price = parseCents(newPrice);
    const errors: Record<string, string> = {};
    if (!newName.trim()) errors.neighborhood = "Informe o nome do bairro.";
    if (!Number.isFinite(price) || price <= 0) errors.neighborhoodPrice = "Informe um valor maior que zero.";
    setFieldErrors(errors);
    setValidationAttempt(attempt => attempt + 1);
    if (Object.keys(errors).length) return;
    setLocal(previous => ({ ...previous, neighborhoods: [...previous.neighborhoods, { name: newName.trim(), priceCents: price }] }));
    setNewName(""); setNewPrice(""); setError(null);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const errors: Record<string, string> = {};
    const flat = parseCents(flatPrice);
    const free = freeAbove.trim() ? parseCents(freeAbove) : null;
    if (local.mode === "fixed" && (!Number.isFinite(flat) || flat < 0)) errors.flat = "Informe um valor válido, como 8,00. Use 0 para entrega gratuita.";
    if (local.mode === "fixed" && free != null && (!Number.isFinite(free) || free < 0)) errors.free = "Informe um valor válido ou deixe vazio.";
    if (!Number.isInteger(Number(estimate)) || Number(estimate) <= 0) errors.estimate = "Informe um prazo inteiro maior que zero.";
    setFieldErrors(errors); setError(null);
    setValidationAttempt(attempt => attempt + 1);
    if (Object.keys(errors).length) return;
    if (local.mode === "by_neighborhood") {
      if (newName.trim() || newPrice.trim()) { setError("Adicione o bairro à lista ou limpe os campos antes de salvar."); return; }
      if (!local.neighborhoods.length) { setError("Adicione pelo menos um bairro e seu valor de entrega."); return; }
    }
    if (local.mode === "by_radius" && !local.radiusZones.length) { setError("Defina o preço de pelo menos uma faixa de distância."); return; }
    try {
      await onSave({ ...local, estimatedValue: Number(estimate), ...(local.mode === "fixed" ? { flatPriceCents: flat, freeAboveCents: free } : {}) });
      onClose();
    } catch { setError("Não foi possível salvar a entrega própria. Seus ajustes foram mantidos. Tente novamente."); }
  }
  return <Modal isOpen title="Configurar entrega própria" subtitle="Defina como cobrar e o prazo que o cliente verá no checkout." presentation="center" size="lg" onClose={close}
    footer={<><Button variant="outline" disabled={saving} onClick={close}>Cancelar</Button><Button type="submit" form={formId} loading={saving} disabled={saving}>Salvar e ativar</Button></>}>
    <form id={formId} onSubmit={save} noValidate>
      <fieldset className="configuration-form" disabled={saving}>
        <section className="configuration-form__section">
          <h3>Valores e área de entrega</h3>
          <FormSelect label="Como cobrar a entrega" value={local.mode} onChange={value => { setLocal({ ...local, mode: value as OwnDeliveryConfig["mode"] }); setFieldErrors({}); setError(null); }} options={[{ value: "fixed", label: "Valor fixo" }, { value: "by_neighborhood", label: "Por bairro" }, { value: "by_radius", label: "Por distância" }]} />
          {local.mode === "fixed" && <div className="configuration-form__grid">
            <FormField label="Preço da entrega (R$)" value={flatPrice} onChange={setFlatPrice} inputProps={{ inputMode: "decimal" }} error={fieldErrors.flat} hint="O mesmo preço para todas as entregas." />
            <FormField label="Entrega grátis a partir de (R$)" value={freeAbove} onChange={setFreeAbove} placeholder="Sem valor mínimo" inputProps={{ inputMode: "decimal" }} error={fieldErrors.free} hint="Opcional. Deixe vazio para manter a cobrança." />
          </div>}
          {local.mode === "by_neighborhood" && <>
            <p>Cadastre cada bairro atendido e o preço correspondente.</p>
            {local.neighborhoods.length > 0 ? <ul className="delivery-neighborhoods">{local.neighborhoods.map((item, i) => <li key={i}>
              <span>{item.name}</span><strong>{money(item.priceCents)}</strong><Button variant="ghost" aria-label={`Remover bairro ${item.name}`} onClick={() => setLocal({ ...local, neighborhoods: local.neighborhoods.filter((_, index) => index !== i) })}><Trash2 size={16} /></Button>
            </li>)}</ul> : <p className="configuration-form__note">Nenhum bairro adicionado. Preencha os campos abaixo para começar.</p>}
            <div className="configuration-form__grid">
              <FormField label="Nome do bairro" value={newName} onChange={setNewName} placeholder="Ex.: Centro" error={fieldErrors.neighborhood} />
              <FormField label="Preço por entrega (R$)" value={newPrice} onChange={setNewPrice} placeholder="Ex.: 8,00" inputProps={{ inputMode: "decimal" }} error={fieldErrors.neighborhoodPrice} />
            </div>
            <div><Button variant="outline" onClick={addNeighborhood}><Plus size={16} /> Adicionar bairro</Button></div>
          </>}
          {local.mode === "by_radius" && <RadiusZonesEditor zones={local.radiusZones} onChange={radiusZones => setLocal({ ...local, radiusZones })} originZip={originZip} />}
        </section>
        <section className="configuration-form__section">
          <h3>Prazo de entrega</h3><p>Informe o tempo estimado para o pedido chegar ao cliente.</p>
          <div className="configuration-form__grid">
            <FormField label="Prazo estimado" value={estimate} onChange={setEstimate} type="number" inputProps={{ min: 1, step: 1 }} error={fieldErrors.estimate} />
            <FormSelect label="Unidade do prazo" value={local.estimatedUnit} onChange={unit => {
              if (Number(estimate) > 0) setEstimate(String(unit === "days" ? Math.max(1, Math.round(Number(estimate) / 1440)) : Number(estimate) * 1440));
              setLocal({ ...local, estimatedUnit: unit as "minutes" | "days" });
            }} options={[{ value: "minutes", label: "Minutos" }, { value: "days", label: "Dias" }]} />
          </div>
        </section>
        <p className="configuration-form__note">Ao salvar, a entrega própria será ativada e o Melhor Envio será desativado.</p>
        {error && <p role="alert" className="form-field-error">{error}</p>}
      </fieldset>
    </form>
  </Modal>;
}
