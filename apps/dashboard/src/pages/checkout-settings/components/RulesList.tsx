import React from "react";
import { Plus, BookOpen } from "lucide-react";
import { Button } from "../../../components/Button.js";
import type { AdvancedRule } from "../lib/draft.js";
import { RuleCard } from "./RuleCard.js";

export function RulesList({
  rules,
  busy,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onReorder,
}: {
  rules: AdvancedRule[];
  busy: boolean;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onReorder: (rules: AdvancedRule[]) => void;
}) {
  if (rules.length === 0) {
    return (
      <div className="cfg-rules-empty">
        <div className="cfg-rules-empty-icon">
          <BookOpen size={40} strokeWidth={1.25} />
        </div>
        <p className="cfg-rules-empty-text">Crie regras para o agente seguir</p>
        <Button
          variant="primary"
          arrow
          disabled={busy}
          onClick={onAdd}
        >
          <Plus size={14} strokeWidth={1.75} />
          Adicionar regra
        </Button>
      </div>
    );
  }

  return (
    <div className="cfg-rules-list">
      {rules.map((r) => (
        <RuleCard
          key={r.id}
          rule={r}
          busy={busy}
          onEdit={() => onEdit(r.id)}
          onDelete={() => {
            if (window.confirm(`Excluir regra "${r.name}"?`)) {
              onDelete(r.id);
            }
          }}
          onToggle={(enabled) => onToggle(r.id, enabled)}
        />
      ))}
      <Button
        variant="outline"
        disabled={busy}
        onClick={onAdd}
      >
        <Plus size={14} strokeWidth={1.75} />
        Adicionar regra
      </Button>
    </div>
  );
}
