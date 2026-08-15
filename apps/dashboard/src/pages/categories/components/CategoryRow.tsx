import React from "react";
import { Pencil, Trash2, Pause, Play, Plus, GripVertical } from "lucide-react";
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
        display: "grid",
        gridTemplateColumns: `${20 + depth * 24}px 1fr 80px 80px 160px`,
        alignItems: "center",
        padding: "10px 16px",
        gap: 10,
        borderBottom: "1px solid var(--border)",
        border: isDropTarget ? "2px solid var(--accent)" : undefined,
        background: isDropTarget ? "var(--accent-soft)" : "transparent",
        transition: "background 150ms, border 150ms",
        cursor: "grab",
      }}
    >
      {/* Grip + indent */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <GripVertical size={14} style={{ color: "var(--faint)", flexShrink: 0 }} />
      </div>

      {/* Name + image */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {category.image_url ? (
          <img
            src={category.image_url}
            alt=""
            style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
          />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, font: "600 13px var(--sans)", color: "var(--accent)" }}>
            {(category.name || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "600 13px var(--sans)", color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {category.name}
          </div>
          {category.description && (
            <div style={{ font: "12px var(--sans)", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280 }}>
              {category.description}
            </div>
          )}
        </div>
      </div>

      {/* Status */}
      <div style={{ textAlign: "center" }}>
        <span
          style={{
            display: "inline-block",
            padding: "3px 8px",
            borderRadius: 5,
            font: "600 10.5px var(--mono)",
            background: category.is_active ? "var(--good-soft)" : "var(--bg)",
            color: category.is_active ? "var(--good)" : "var(--faint)",
            border: `1px solid ${category.is_active ? "var(--good)" : "var(--border)"}`,
          }}
        >
          {category.is_active ? "Ativa" : "Pausada"}
        </span>
      </div>

      {/* Product count */}
      <div style={{ textAlign: "center", font: "13px var(--mono)", color: "var(--muted)" }}>
        {category.product_count ?? 0}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, font: "600 11px var(--sans)" }}
        >
          <Pencil size={11} /> Editar
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleActive(); }}
          title={category.is_active ? "Pausar" : "Ativar"}
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: category.is_active ? "var(--muted)" : "var(--good)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
        >
          {category.is_active ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Excluir"
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
        >
          <Trash2 size={12} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAddChild(); }}
          title="Adicionar subcategoria"
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--accent)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
