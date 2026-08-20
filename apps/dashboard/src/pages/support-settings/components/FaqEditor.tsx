import React, { useRef, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { FormField, FormTextarea } from "../../../components/FormField.js";
import type { SupportFaqItem } from "@zyon/shared-types";

interface Props {
  index: number;
  item: SupportFaqItem;
  disabled: boolean;
  onUpdate: (field: "question" | "answer", val: string) => void;
  onRemove: () => void;
}

export function FaqEditor(props: Props) {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface-raised)",
        overflow: "hidden",
      }}
    >
      {/* FAQ item header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: "var(--radius-sm)",
              background: "var(--color-brand-subtle)",
              color: "var(--color-brand)",
              fontFamily: "var(--font-data)",
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {props.index + 1}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              fontWeight: 600,
            }}
          >
            {props.item.question ? props.item.question.slice(0, 60) + (props.item.question.length > 60 ? "…" : "") : "Pergunta sem título"}
          </span>
        </div>
        <button
          type="button"
          disabled={props.disabled}
          onClick={props.onRemove}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            color: "var(--color-error)",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: "var(--radius-sm)",
            padding: "4px var(--space-2)",
            fontSize: 12,
            fontWeight: 600,
            cursor: props.disabled ? "not-allowed" : "pointer",
            minHeight: "unset",
          }}
        >
          <Trash2 size={12} />
          Remover
        </button>
      </div>

      {/* FAQ item body */}
      <div
        style={{
          display: "grid",
          gap: "var(--space-3)",
          padding: "var(--space-4)",
        }}
      >
        <FormField
          label="Pergunta do comprador"
          type="text"
          value={props.item.question}
          maxLength={200}
          disabled={props.disabled}
          placeholder="Ex: Qual o prazo de entrega?"
          onChange={(val) => props.onUpdate("question", val)}
        />

        <FormTextarea
          label="Resposta sugerida"
          value={props.item.answer}
          maxLength={1000}
          rows={3}
          disabled={props.disabled}
          placeholder="Ex: Entregamos em 5-10 dias úteis para todo Brasil."
          onChange={(val) => props.onUpdate("answer", val)}
        />
      </div>
    </div>
  );
}
