import React from "react";
import { Button } from "../../../components/Button.js";
import { RowActionMenu } from "../../../components/RowActionMenu.js";
import { Pencil, GripVertical } from "lucide-react";
import type { ProductCategoryDTO } from "../../../api/endpoints/catalog.js";

interface CategoryRowProps {
  category: ProductCategoryDTO & { children?: any[] };
  depth: number;
  disabled?: boolean;
  isDropTarget: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
  onAddChild: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function CategoryRow({
  category,
  disabled,
  depth,
  isDropTarget,
  onEdit,
  onDelete,
  onToggleActive,
  onAddChild,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: CategoryRowProps) {
  return (
    <tr
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver(e);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top || e.clientY > rect.bottom
        ) {
          onDragLeave(e);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onDrop(e);
      }}
      style={{
        cursor: "pointer",
        background: isDropTarget ? "var(--color-brand-subtle)" : "transparent",
        transition: "background 0.15s",

      }}
    >
      <td style={{ padding: "12px 22px", paddingLeft: 22 + Math.min(depth, 4) * 20, borderBottom: "1px solid var(--color-border)", font: "13px var(--font-sans)", color: "var(--color-text)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GripVertical size={13} style={{ color: "var(--color-text-faint)", opacity: 0.5, flexShrink: 0 }} />
          <span>{category.name}</span>
        </div>
      </td>
      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--color-border)", font: "13px var(--font-mono)", color: "var(--color-brand)" }}>
        {category.product_count ?? 0}
      </td>
      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--color-border)", font: "12px var(--font-mono)", color: category.is_active ? "var(--color-text)" : "var(--color-text-faint)" }}>
        {category.is_active ? "Ativa" : "Pausada"}
      </td>
      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>
        <div className="categories-actions">
          <Button variant="outline" size="sm" onClick={onEdit} disabled={disabled} aria-label={"Editar categoria " + category.name}><Pencil size={14} /> Editar</Button>
          <RowActionMenu label={"Ações de " + category.name} actions={[
            { label: category.is_active ? "Pausar categoria" : "Ativar categoria", disabled, onSelect: onToggleActive },
            { label: "Adicionar subcategoria", disabled, onSelect: onAddChild },
            { label: "Excluir categoria", danger: true, disabled, onSelect: onDelete },
          ]} />
        </div>
      </td>
    </tr>
  );
}
