import React, { useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "../../../components/Button.js";
import type { AdvancedRule } from "../lib/draft.js";

const CONDITION_FIELDS = [
  { value: "cart_total", label: "Valor do carrinho" },
  { value: "shipping_cost", label: "Custo do frete" },
  { value: "product_in_cart", label: "Produto no carrinho" },
  { value: "category_in_cart", label: "Categoria no carrinho" },
  { value: "coupon_applied", label: "Cupom aplicado" },
  { value: "buyer_type", label: "Tipo de comprador" },
  { value: "payment_method", label: "Método de pagamento" },
  { value: "trigger_fired", label: "Trigger disparado" },
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
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "==", label: "=" },
  { value: "contains", label: "contém" },
];

type Condition = { field: string; operator: string; value: string | number | boolean };

export function RuleEditor({
  rule,
  onSave,
  onCancel,
  busy,
}: {
  rule: AdvancedRule | null;
  onSave: (rule: AdvancedRule) => void;
  onCancel: () => void;
  busy: boolean;
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
    if (!name.trim()) return;
    const newRule: AdvancedRule = {
      id: rule?.id ?? crypto.randomUUID(),
      name: name.trim(),
      conditions,
      action: { type: actionType, params: actionParams },
      enabled: rule?.enabled ?? true,
      priority: rule?.priority ?? 1,
    };
    onSave(newRule);
  }

  return (
    <div className="cfg-side-panel-overlay" onClick={onCancel}>
      <aside className="cfg-side-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cfg-side-panel-head">
          <div>
            <h3>{rule ? "Editar regra" : "Nova regra"}</h3>
            <p className="cfg-side-panel-subtitle">Defina quando e como o agente deve agir.</p>
          </div>
          <button type="button" className="cfg-side-panel-close" onClick={onCancel} disabled={busy}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="cfg-side-panel-body">
          {/* Name */}
          <div className="cfg-rule-field">
            <label htmlFor="rule-name">Nome</label>
            <input
              id="rule-name"
              type="text"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Frete grátis acima de R$200"
            />
          </div>

          {/* Conditions */}
          <div className="cfg-rule-section">
            <div className="cfg-rule-section-head">
              <h4>SE</h4>
              <span className="cfg-rule-count">{conditions.length}</span>
            </div>
            <div className="cfg-rule-conditions">
              {conditions.map((c, i) => (
                <div key={i} className="cfg-rule-condition-row">
                  <select value={c.field} disabled={busy} onChange={(e) => updateCondition(i, { field: e.target.value })}>
                    {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <select value={c.operator} disabled={busy} onChange={(e) => updateCondition(i, { operator: e.target.value })}>
                    {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                  </select>
                  <input
                    type="text"
                    value={String(c.value)}
                    disabled={busy}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder="Valor"
                  />
                  <button type="button" className="cfg-rule-remove-btn" disabled={busy} onClick={() => removeCondition(i)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="cfg-rule-add-btn" disabled={busy} onClick={addCondition}>
              <Plus size={12} /> Condição
            </button>
          </div>

          {/* Action */}
          <div className="cfg-rule-section">
            <h4>ENTÃO</h4>
            <select value={actionType} disabled={busy} onChange={(e) => { setActionType(e.target.value); setActionParams({}); }}>
              {ACTION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>

            {actionType === "offer_discount" && (
              <div className="cfg-rule-param">
                <label>Desconto (%)</label>
                <input type="number" min="0" max="50" value={actionParams.percent ?? ""} disabled={busy} onChange={(e) => setActionParams({ ...actionParams, percent: e.target.value ? Number(e.target.value) : "" })} placeholder="10" />
              </div>
            )}
            {actionType === "show_message" && (
              <div className="cfg-rule-param">
                <label>Mensagem</label>
                <textarea value={actionParams.message ?? ""} disabled={busy} onChange={(e) => setActionParams({ ...actionParams, message: e.target.value })} placeholder="Mensagem que o agente enviará..." rows={3} />
              </div>
            )}
            {actionType === "suggest_product" && (
              <div className="cfg-rule-param">
                <label>Nome do produto</label>
                <input type="text" value={actionParams.productName ?? ""} disabled={busy} onChange={(e) => setActionParams({ ...actionParams, productName: e.target.value })} placeholder="Ex: Kit Hidratante" />
              </div>
            )}
            {actionType === "offer_coupon" && (
              <div className="cfg-rule-param">
                <label>Código do cupom</label>
                <input type="text" value={actionParams.code ?? ""} disabled={busy} onChange={(e) => setActionParams({ ...actionParams, code: e.target.value })} placeholder="BEMVINDO10" />
              </div>
            )}
            {actionType === "offer_installments" && (
              <div className="cfg-rule-param">
                <label>Parcelas</label>
                <input type="number" min="2" max="12" value={actionParams.maxInstallments ?? ""} disabled={busy} onChange={(e) => setActionParams({ ...actionParams, maxInstallments: e.target.value ? Number(e.target.value) : "" })} placeholder="12" />
              </div>
            )}
          </div>

          {/* Preview */}
          {previewText && (
            <div className="cfg-rule-preview">
              <span className="cfg-rule-preview-label">Preview</span>
              <p>{previewText}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="cfg-side-panel-footer">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant="primary" arrow disabled={busy || !name.trim()} onClick={handleSave}>
            {rule ? "Atualizar" : "Criar regra"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function buildPreview(conditions: Condition[], actionType: string, actionParams: Record<string, string | number>): string {
  if (conditions.length === 0 && !actionType) return "";
  const fieldLabels: Record<string, string> = { cart_total: "carrinho", shipping_cost: "frete", product_in_cart: "produto", category_in_cart: "categoria", coupon_applied: "cupom", buyer_type: "comprador", payment_method: "pagamento", trigger_fired: "trigger", cart_item_count: "itens" };
  const condText = conditions.length === 0 ? "sempre" : conditions.map((c) => `${fieldLabels[c.field] ?? c.field} ${c.operator} ${c.value || "?"}`).join(" E ");
  const actionLabels: Record<string, string> = { offer_discount: `oferecer ${actionParams.percent || "?"}% desconto`, offer_free_shipping: "oferecer frete grátis", suggest_product: `sugerir ${actionParams.productName || "produto"}`, show_message: `dizer: "${actionParams.message || "..."}"`, offer_installments: `oferecer ${actionParams.maxInstallments || "?"}x`, do_nothing: "não intervir", offer_coupon: `cupom ${actionParams.code || "?"}` };
  return `SE ${condText} → ${actionLabels[actionType] || actionType}`;
}
