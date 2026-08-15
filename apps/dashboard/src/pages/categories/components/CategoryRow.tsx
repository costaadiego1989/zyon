import React from "react";
import { Pencil, Trash2, Pause, Play, GripVertical } from "lucide-react";
import type { ProductCategoryDTO } from "../../../api/endpoints/catalog.js";

interface CategoryRowProps {
  category: ProductCategoryDTO;
  isDropTarget: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function CategoryRow({
  category,
  isDropTarget,
  onEdit,
  onDelete,
  onToggleActive,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: CategoryRowProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
          onDragLeave(e);
        }
      }}
      onDrop={onDrop}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 0",
        gap: 10,
        cursor: "grab",
        border: isDropTarget ? "2px solid var(--accent)" : "1px solid transparent",
        background: isDropTarget ? "var(--accent-soft)" : "transparent",
        transition: "all 150ms",
        borderRadius: 6,
        paddingLeft: 8,
        paddingRight: 8,
      }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        style={{
          width: 20,
          height: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          background: "none",
          color: "var(--faint)",
          cursor: "grab",
          padding: 0,
          flex: "none",
        }}
        title="Arraste para reparentar"
      >
        <GripVertical size={14} />
      </button>

      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {category.image_url ? (
          <img
            src={category.image_url}
            alt={category.name}
            style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flex: "none", border: "1px solid var(--border)" }}
          />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", font: "600 13px var(--sans)", color: "var(--accent)" }}>
            {category.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "600 13px var(--sans)", color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {category.name}
          </div>
          {category.description ? (
            <div style={{ font: "12px var(--sans)", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 240 }}>
              {category.description}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ width: 80, textAlign: "center", flex: "none" }}>
        <span
          style={{
            display: "inline-block",
            padding: "3px 8px",
            borderRadius: 5,
            font: "600 10.5px var(--mono)",
            letterSpacing: "0.03em",
            background: category.is_active ? "var(--good-soft)" : "var(--bg)",
            color: category.is_active ? "var(--good)" : "var(--faint)",
            border: `1px solid ${category.is_active ? "var(--good)" : "var(--border)"}`,
          }}
        >
          {category.is_active ? "Ativa" : "Pausada"}
        </span>
      </div>

      <div style={{ width: 80, textAlign: "center", flex: "none", font: "13px var(--mono)", color: "var(--muted)" }}>
        {category.product_count ?? 0}
      </div>

      <div style={{ width: 140, display: "flex", justifyContent: "flex-end", gap: 5, flex: "none" }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={`Editar ${category.name}`}
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, font: "600 11px var(--sans)" }}
        >
          <Pencil size={11} /> Editar
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleActive();
          }}
          aria-label={category.is_active ? `Pausar ${category.name}` : `Ativar ${category.name}`}
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: category.is_active ? "var(--muted)" : "var(--good)", cursor: "pointer", display: "inline-flex", alignItems: "center", font: "600 11px var(--sans)" }}
        >
          {category.is_active ? <Pause size={11} /> : <Play size={11} />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Remover ${category.name}`}
          style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", cursor: "pointer", display: "inline-flex", alignItems: "center", font: "600 11px var(--sans)" }}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}
