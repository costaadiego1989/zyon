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
    <div
      draggable
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
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
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
        display: "flex",
        alignItems: "center",
        padding: "14px 20px",
        paddingLeft: 20 + depth * 28,
        gap: 12,
        borderBottom: "1px solid var(--border)",
        background: isDropTarget ? "var(--accent-soft)" : "transparent",
        borderLeft: isDropTarget ? "3px solid var(--accent)" : "3px solid transparent",
        transition: "background 120ms, border-left 120ms",
        cursor: "grab",
        minHeight: 56,
      }}
    >
      {/* Drag handle */}
      <GripVertical size={14} style={{ color: "var(--faint)", flexShrink: 0, opacity: 0.5 }} />

      {/* Name — takes remaining space */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ font: "500 14px var(--sans)", color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {category.name}
        </span>
        {category.description && (
          <span style={{ font: "12px var(--sans)", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
            — {category.description}
          </span>
        )}
      </div>

      {/* Product count */}
      <div style={{ width: 80, textAlign: "center", font: "600 13px var(--mono)", color: "var(--accent)", flexShrink: 0 }}>
        {category.product_count ?? 0}
      </div>

      {/* Status */}
      <div style={{ width: 80, textAlign: "center", flexShrink: 0 }}>
        <span style={{ font: "500 12px var(--sans)", color: category.is_active ? "var(--ink)" : "var(--faint)" }}>
          {category.is_active ? "Ativo" : "Pausado"}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, font: "600 12px var(--sans)" }}
        >
          <Pencil size={12} /> Editar
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleActive(); }}
          style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, font: "600 12px var(--sans)" }}
        >
          {category.is_active ? <Pause size={12} /> : <Play size={12} />}
          {category.is_active ? "Pausar" : "Ativar"}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, font: "600 12px var(--sans)" }}
        >
          <Trash2 size={12} /> Remover
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAddChild(); }}
          title="Adicionar subcategoria"
          style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
