import { useEffect, useId } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../../components/Button.js";
import { Modal } from "../../components/Modal.js";
import { FormField, FormSelect } from "../../components/FormField.js";
import type { CreateCouponForm, useCouponsPage } from "./useCouponsPage.js";
import "../../components/configuration-form.css";
export function CouponForm({ vm }: { vm: ReturnType<typeof useCouponsPage> }) {
  const formId = useId();
  useEffect(() => {
    if (vm.validationAttempt) document.getElementById(formId)?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
  }, [vm.validationAttempt, formId]);
  return <Modal isOpen={vm.showForm} title="Criar cupom" subtitle="Escolha o benefício e as condições para usar o código no checkout." presentation="center" size="lg" onClose={vm.closeForm}
    footer={<><Button variant="outline" disabled={vm.creating} onClick={vm.closeForm}>Cancelar</Button><Button type="submit" form={formId} loading={vm.creating} disabled={vm.creating}>Criar cupom</Button></>}>
    <form id={formId} noValidate onSubmit={event => { event.preventDefault(); void vm.handleCreate(); }}>
      <fieldset className="configuration-form" disabled={vm.creating}>
        <section className="configuration-form__section">
          <h3>Código e benefício</h3>
          <FormField label="Código do cupom" value={vm.form.code} onChange={code => vm.patch({ code: code.toUpperCase() })} placeholder="Ex.: BEMVINDO10" hint="Este é o código que você vai compartilhar com os clientes." error={vm.fieldErrors.code} />
          <div><Button variant="outline" onClick={vm.generateCode}><RefreshCw size={14} /> Gerar código</Button></div>
          <div className="configuration-form__grid">
            <FormSelect label="Tipo de desconto" value={vm.form.discountType} onChange={discountType => vm.patch({ discountType: discountType as CreateCouponForm["discountType"] })} options={[{ value: "percent", label: "Percentual (%)" }, { value: "fixed", label: "Valor fixo (R$)" }, { value: "free_shipping", label: "Frete grátis" }]} />
            {vm.form.discountType !== "free_shipping" && <FormField label={vm.form.discountType === "percent" ? "Desconto (%)" : "Desconto (R$)"} type="number" value={vm.form.discountValue} onChange={discountValue => vm.patch({ discountValue })} inputProps={{ min: 0.01, step: 0.01, max: vm.form.discountType === "percent" ? 100 : undefined }} error={vm.fieldErrors.discountValue} />}
          </div>
          <p>{vm.form.discountType === "free_shipping" ? "O benefício será aplicado ao frete do pedido." : "O desconto será aplicado ao carrinho do cliente."} Restrições por produto ou categoria ainda não estão disponíveis.</p>
        </section>
        <section className="configuration-form__section">
          <h3>Condições de uso</h3><p>Deixe os campos vazios se não quiser definir esses limites.</p>
          <div className="configuration-form__grid">
            <FormField label="Valor mínimo do carrinho (R$)" type="number" value={vm.form.minCartValue} onChange={minCartValue => vm.patch({ minCartValue })} placeholder="Sem valor mínimo" inputProps={{ min: 0, step: 0.01 }} error={vm.fieldErrors.minCartValue} />
            <FormField label="Limite total de usos" type="number" value={vm.form.maxUses} onChange={maxUses => vm.patch({ maxUses })} placeholder="Sem limite" inputProps={{ min: 1, step: 1 }} error={vm.fieldErrors.maxUses} hint="Total de resgates permitido para este cupom." />
          </div>
        </section>
        <section className="configuration-form__section">
          <h3>Validade</h3>
          <div className="configuration-form__grid">
            <FormField label="Data de início" type="date" value={vm.form.startsAt} onChange={startsAt => vm.patch({ startsAt })} hint="Se ficar vazia, o cupom começa hoje." />
            <FormField label="Data final" type="date" value={vm.form.expiresAt} onChange={expiresAt => vm.patch({ expiresAt })} hint="Opcional. Deixe vazia para não definir uma data final." error={vm.fieldErrors.expiresAt} />
          </div>
        </section>
        {vm.formError && <p role="alert" className="form-field-error">{vm.formError}</p>}
      </fieldset>
    </form>
  </Modal>;
}
