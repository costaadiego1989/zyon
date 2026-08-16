import React from "react";
import { Pencil, Pause, Play, Trash2, Plus, GripVertical } from "lucide-react";
import type { ProductCategoryDTO } from "../../../api/endpoints/catalog.js";

interface CategoryRowProps {
  category: ProductCategoryDTO & { children?: any[] };
  depth: number;
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
      draggable
      onClick={() => onEdit()}
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
        onDrop(e);
      }}
      style={{
        cursor: "pointer",
        background: isDropTarget ? "var(--accent-soft)" : "transparent",
        transition: "background 0.15s",
        borderLeft: isDropTarget ? "3px solid var(--accent)" : "3px solid transparent",
      }}
    >
      <td style={{ padding: "12px 22px", paddingLeft: 22 + depth * 24, borderBottom: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GripVertical size={13} style={{ color: "var(--faint)", opacity: 0.5, flexShrink: 0 }} />
          <span>{category.name}</span>
        </div>
      </td>
      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)", font: "13px var(--mono)", color: "var(--accent)" }}>
        {category.product_count ?? 0}
      </td>
      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)", font: "12px var(--mono)", color: category.is_active ? "var(--ink)" : "var(--faint)" }}>
        {category.is_active ? "Ativo" : "Pausado"}
      </td>
      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
        <div style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)" }}
          >
            <Pencil size={12} /> Editar
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleActive(); }}
            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: category.is_active ? "var(--muted)" : "var(--good)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)" }}
          >
            {category.is_active ? <><Pause size={12} /> Pausar</> : <><Play size={12} /> Ativar</>}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)" }}
          >
            <Trash2 size={12} /> Remover
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddChild(); }}
            aria-label="Adicionar subcategoria"
            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--accent)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)" }}
          >
            <Plus size={12} /> Adicionar
          </button>
        </div>
      </td>
    </tr>
  );
}
