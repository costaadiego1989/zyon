import React, { useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { FormField, FormSelect, FormTextarea } from "../../../components/FormField.js";
import { Modal } from "../../../components/Modal.js";
import { CouponPicker as CouponDropdown } from "./CouponPicker.js";
import "../checkout-refinements.css";
import type { AdvancedRule } from "../lib/draft.js";

export { CouponPicker as CouponDropdown } from "./CouponPicker.js";

const CONDITION_FIELDS = [
  { value: "cart_total", label: "Valor do carrinho" },
  { value: "shipping_cost", label: "Custo do frete" },
  { value: "product_in_cart", label: "Produto no carrinho" },
  { value: "category_in_cart", label: "Categoria no carrinho" },
  { value: "coupon_applied", label: "Cupom aplicado" },
  { value: "buyer_type", label: "Tipo de comprador" },
  { value: "payment_method", label: "Método de pagamento" },
  { value: "trigger_fired", label: "Sinal acionado" },
  { value: "cart_item_count", label: "Itens no carrinho" },
];

const ACTION_TYPES = [
  { value: "offer_discount", label: "Oferecer desconto" },
  { value: "offer_free_shipping", label: "Oferecer frete grátis" },
  { value: "suggest_product", label: "Sugerir produto" },
  { value: "show_message", label: "Enviar mensagem" },
  { value: "offer_installments", label: "Oferecer parcelamento" },
  { value: "do_nothing", label: "Não intervir" },
  { value: "offer_coupon", label: "Oferecer cupom" },
];

const OPERATORS = [
  { value: ">", label: "Maior que" },
  { value: "<", label: "Menor que" },
  { value: ">=", label: "Maior ou igual" },
  { value: "<=", label: "Menor ou igual" },
  { value: "==", label: "Igual a" },
  { value: "contains", label: "Contém" },
];

type Condition = { field: string; operator: string; value: string | number | boolean };

export function RuleEditor({
  rule,
  onSave,
  onCancel,
  busy,
  saveLabel = "Aplicar ao rascunho",
  saveHint = "Preencha nome, condições e ação. Depois de aplicar, salve a página para publicar a regra.",
}: {
  rule: AdvancedRule | null;
  onSave: (rule: AdvancedRule) => void;
  onCancel: () => void;
  busy: boolean;
  saveLabel?: string;
  saveHint?: string;
}) {
  const [name, setName] = useState("");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [actionType, setActionType] = useState("offer_discount");
  const [actionParams, setActionParams] = useState<Record<string, string | number>>({});

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setConditions(rule.conditions);
      setActionType(rule.action.type);
      setActionParams(rule.action.params);
    } else {
      setName("");
      setConditions([{ field: "cart_total", operator: ">", value: "" }]);
      setActionType("offer_discount");
      setActionParams({});
    }
  }, [rule]);

  const previewText = buildPreview(conditions, actionType, actionParams);
  const hasValidAction = actionType === "offer_discount"
    ? Number(actionParams.percent) > 0 && Number(actionParams.percent) <= 100
    : actionType === "offer_coupon"
      ? Boolean(String(actionParams.code ?? "").trim())
      : actionType === "show_message"
        ? Boolean(String(actionParams.message ?? "").trim())
        : actionType === "suggest_product"
          ? Boolean(String(actionParams.productName ?? "").trim())
          : actionType === "offer_installments"
            ? Number(actionParams.maxInstallments) >= 2 && Number(actionParams.maxInstallments) <= 12
            : true;
  const hasValidConditions = conditions.length > 0 && conditions.every((condition) => String(condition.value).trim().length > 0);
  const canSave = Boolean(name.trim()) && hasValidConditions && hasValidAction;

  function addCondition() {
    setConditions([...conditions, { field: "cart_total", operator: ">", value: "" }]);
  }

  function removeCondition(i: number) {
    setConditions(conditions.filter((_, idx) => idx !== i));
  }

  function updateCondition(i: number, partial: Partial<Condition>) {
    setConditions(conditions.map((c, idx) => (idx === i ? { ...c, ...partial } : c)));
  }

  function handleSave() {
    if (!canSave || busy) return;
    const newRule: AdvancedRule = {
      productId: rule?.productId,
      id: rule?.id ?? crypto.randomUUID(),
      name: name.trim(),
      conditions,
      action: { type: actionType, params: actionParams },
      enabled: rule?.enabled ?? true,
      priority: rule?.priority ?? 1,
    };
    onSave(newRule);
  }

  return <Modal isOpen title={rule ? "Editar regra" : "Nova regra"} subtitle="Escolha quando a regra deve ser aplicada e o que o agente deve fazer." presentation="center" size="lg" onClose={() => { if (!busy) onCancel(); }} footer={<>
    <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
    <Button variant="primary" disabled={busy || !canSave} onClick={handleSave}>{saveLabel}</Button>
  </>}>
    <div className="rule-editor">
      <FormField label="Nome" value={name} onChange={setName} disabled={busy} placeholder="Ex.: Desconto para compras acima de R$ 200" />
      <section className="rule-editor__section" aria-label="Condições da regra">
        <div className="rule-editor__section-heading"><h3>Quando aplicar</h3><p>Todas as condições abaixo precisam ser atendidas.</p></div>
        <div className="rule-editor__conditions">{conditions.map((condition, index) => <div className="rule-editor__condition" key={index}>
          <div className="rule-editor__condition-heading"><h4>Condição {index + 1}</h4><Button variant="ghost" size="sm" disabled={busy} onClick={() => removeCondition(index)}><X size={15} aria-hidden="true" /> Remover condição {index + 1}</Button></div>
          <FormSelect label={"Campo da condição " + (index + 1)} value={condition.field} onChange={field => updateCondition(index, { field })} options={CONDITION_FIELDS} disabled={busy} />
          <div className="rule-editor__pair">
            <FormSelect label={"Comparação da condição " + (index + 1)} value={condition.operator} onChange={operator => updateCondition(index, { operator })} options={OPERATORS} disabled={busy} />
            <FormField label={"Valor da condição " + (index + 1)} value={String(condition.value)} onChange={value => updateCondition(index, { value })} disabled={busy} placeholder={condition.field === "cart_total" ? "Ex.: 200" : "Informe o valor"} />
          </div>
        </div>)}</div>
        <Button variant="outline" onClick={addCondition} disabled={busy}><Plus size={16} aria-hidden="true" /> Adicionar condição</Button>
      </section>
      <section className="rule-editor__section" aria-label="Ação da regra">
        <div className="rule-editor__section-heading"><h3>O que o agente deve fazer</h3><p>A ação será avaliada dentro dos limites comerciais da loja.</p></div>
        <FormSelect label="Ação do agente" value={actionType} onChange={value => { setActionType(value); setActionParams({}); }} options={ACTION_TYPES} disabled={busy} />
        {actionType === "offer_discount" && <div className="rule-editor__pair">
          <FormField label="Desconto (%)" type="number" inputProps={{ min: 1, max: 100 }} value={String(actionParams.percent ?? "")} onChange={value => setActionParams({ ...actionParams, percent: value ? Number(value) : "" })} disabled={busy} placeholder="Ex.: 10" hint="Percentual aplicado à compra." />
          <FormField label="Teto do desconto (R$), opcional" type="number" inputProps={{ min: 0, step: 0.01 }} value={String(actionParams.maxDiscountReais ?? "")} onChange={value => { const next = { ...actionParams }; if (value) next.maxDiscountReais = Number(value); else delete next.maxDiscountReais; setActionParams(next); }} disabled={busy} placeholder="Ex.: 30,00" hint="Limita o valor total do desconto." />
        </div>}
        {actionType === "show_message" && <FormTextarea label="Mensagem" value={String(actionParams.message ?? "")} onChange={message => setActionParams({ ...actionParams, message })} disabled={busy} rows={3} placeholder="Escreva a mensagem que o agente enviará." />}
        {actionType === "suggest_product" && <FormField label="Nome do produto" value={String(actionParams.productName ?? "")} onChange={productName => setActionParams({ ...actionParams, productName })} disabled={busy} placeholder="Ex.: Kit hidratante" />}
        {actionType === "offer_coupon" && <CouponDropdown value={String(actionParams.code ?? "")} onChange={code => setActionParams({ ...actionParams, code })} disabled={busy} />}
        {actionType === "offer_installments" && <FormField label="Parcelas" type="number" inputProps={{ min: 2, max: 12, step: 1 }} value={String(actionParams.maxInstallments ?? "")} onChange={value => setActionParams({ ...actionParams, maxInstallments: value ? Number(value) : "" })} disabled={busy} placeholder="Ex.: 6" hint="Defina entre 2 e 12 parcelas." />}
      </section>
      {previewText && <div className="rule-editor__preview"><h3>Resumo da regra</h3><p>{previewText}</p></div>}
      <p className="rule-editor__hint">{saveHint}</p>
    </div>
  </Modal>;
}

function buildPreview(conditions: Condition[], actionType: string, actionParams: Record<string, string | number>): string {
  if (conditions.length === 0 && !actionType) return "";
  const fieldLabels: Record<string, string> = { cart_total: "carrinho", shipping_cost: "frete", product_in_cart: "produto", category_in_cart: "categoria", coupon_applied: "cupom", buyer_type: "comprador", payment_method: "pagamento", trigger_fired: "sinal", cart_item_count: "itens" };
  const condText = conditions.length === 0 ? "sempre" : conditions.map((c) => `${fieldLabels[c.field] ?? c.field} ${c.operator} ${c.value || "?"}`).join(" E ");
  const discountLabel = actionParams.maxDiscountReais
    ? `oferecer ${actionParams.percent || "?"}% desconto (máx R$${Number(actionParams.maxDiscountReais).toFixed(2)})`
    : `oferecer ${actionParams.percent || "?"}% desconto`;
  const actionLabels: Record<string, string> = { offer_discount: discountLabel, offer_free_shipping: "oferecer frete grátis", suggest_product: `sugerir ${actionParams.productName || "produto"}`, show_message: `dizer: "${actionParams.message || "..."}"`, offer_installments: `oferecer ${actionParams.maxInstallments || "?"}x`, do_nothing: "não intervir", offer_coupon: `cupom ${actionParams.code || "?"}` };
  return `Se ${condText} → ${actionLabels[actionType] || actionType}`;
}
