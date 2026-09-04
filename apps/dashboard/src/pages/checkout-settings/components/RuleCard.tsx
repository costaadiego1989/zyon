import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { AdvancedRule } from "../lib/draft.js";
import { ToggleSwitch } from "./ToggleSwitch.js";

const FIELD_LABELS: Record<string, string> = {
  cart_total: "carrinho",
  shipping_cost: "frete",
  product_in_cart: "produto",
  category_in_cart: "categoria",
  coupon_applied: "cupom",
  buyer_type: "comprador",
  payment_method: "pagamento",
  trigger_fired: "trigger",
  cart_item_count: "itens",
};

const OPERATOR_LABELS: Record<string, string> = {
  ">": ">",
  "<": "<",
  ">=": ">=",
  "<=": "<=",
  "==": "=",
  "!=": "!=",
  contains: "contém",
  not_contains: "não contém",
  equals: "=",
  not_equals: "!=",
};

const ACTION_LABELS: Record<string, string> = {
  offer_discount: "oferecer desconto",
  offer_free_shipping: "oferecer frete grátis",
  suggest_product: "sugerir produto",
  show_message: "enviar mensagem",
  offer_installments: "oferecer parcelamento",
  do_nothing: "não intervir",
  offer_coupon: "oferecer cupom",
};

function conditionToText(c: { field: string; operator: string; value: string | number | boolean }): string {
  const field = FIELD_LABELS[c.field] ?? c.field;
  const op = OPERATOR_LABELS[c.operator] ?? c.operator;
  const val = typeof c.value === "boolean" ? (c.value ? "sim" : "não") : String(c.value);
  return `${field} ${op} ${val}`;
}

function actionToText(a: { type: string; params: Record<string, string | number> }): string {
  const label = ACTION_LABELS[a.type] ?? a.type;
  const paramStr = Object.entries(a.params)
    .map(([k, v]) => `${v}${k === "percent" ? "%" : ""}`)
    .join(", ");
  return paramStr ? `${label} (${paramStr})` : label;
}

export function RuleCard({
  rule,
  busy,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: AdvancedRule;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const conditionsText = rule.conditions.map(conditionToText).join(" E ");

  return (
    <div className={`cfg-rule-card${rule.enabled ? " on" : ""}`}>
      <div className="cfg-rule-card-priority">{rule.priority}</div>
      <div className="cfg-rule-card-body">
        <strong className="cfg-rule-card-name">{rule.name}</strong>
        {rule.conditions.length > 0 && (
          <span className="cfg-rule-card-conditions">{conditionsText}</span>
        )}
        <span className="cfg-rule-card-action">&rarr; {actionToText(rule.action)}</span>
      </div>
      <div className="cfg-rule-card-controls">
        <ToggleSwitch
          id={`rule-toggle-${rule.id}`}
          checked={rule.enabled}
          disabled={busy}
          onChange={onToggle}
        />
        <button
          type="button"
          className="cfg-rule-icon-btn"
          disabled={busy}
          onClick={onEdit}
          aria-label="Editar regra"
        >
          <Pencil size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="cfg-rule-icon-btn danger"
          disabled={busy}
          onClick={onDelete}
          aria-label="Excluir regra"
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
