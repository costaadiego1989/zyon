import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { CategoryTreeNode } from "../useCategoriesPage.js";
import type { ProductCategoryDTO } from "../../../api/endpoints/catalog.js";
import { CategoryRow } from "./CategoryRow.js";

interface CategoryTreeProps {
  tree: CategoryTreeNode[];
  onEdit: (category: ProductCategoryDTO) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onAddChild: (parentId: string) => void;
  onReparent: (categoryId: string, newParentId: string | null) => void;
}

function TreeNode({
  node,
  depth,
  dragOverId,
  setDragOverId,
  onEdit,
  onDelete,
  onToggleActive,
  onAddChild,
  onReparent,
}: {
  node: CategoryTreeNode;
  depth: number;
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
  onEdit: (category: ProductCategoryDTO) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onAddChild: (parentId: string) => void;
  onReparent: (categoryId: string, newParentId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <>
      <div style={{ position: "relative" }}>
        {hasChildren && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              position: "absolute",
              left: 16 + depth * 24,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 2,
              width: 18,
              height: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "var(--card)",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--muted)",
              padding: 0,
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
        <CategoryRow
          category={node}
          depth={depth}
          isDropTarget={dragOverId === node.id}
          onEdit={() => onEdit(node)}
          onDelete={() => onDelete(node.id)}
          onToggleActive={() => onToggleActive(node.id, node.is_active)}
          onAddChild={() => onAddChild(node.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData("category-id", node.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => setDragOverId(node.id)}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => {
            const draggedId = e.dataTransfer.getData("category-id");
            if (draggedId && draggedId !== node.id) {
              onReparent(draggedId, node.id);
            }
            setDragOverId(null);
          }}
        />
      </div>
      {expanded && hasChildren
        ? node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              dragOverId={dragOverId}
              setDragOverId={setDragOverId}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleActive={onToggleActive}
              onAddChild={onAddChild}
              onReparent={onReparent}
            />
          ))
        : null}
    </>
  );
}

export function CategoryTree({ tree, onEdit, onDelete, onToggleActive, onAddChild, onReparent }: CategoryTreeProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("category-id");
        if (id) onReparent(id, null);
        setDragOverId(null);
      }}
      onDragEnd={() => setDragOverId(null)}
    >
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "20px 1fr 80px 80px 160px",
          alignItems: "center",
          padding: "10px 16px",
          gap: 10,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <div />
        <div style={{ font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)" }}>NOME</div>
        <div style={{ font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", textAlign: "center" }}>STATUS</div>
        <div style={{ font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", textAlign: "center" }}>PRODUTOS</div>
        <div style={{ font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", textAlign: "right" }}>AÇÕES</div>
      </div>

      {/* Rows */}
      {tree.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", font: "13px var(--sans)" }}>
          Nenhuma categoria criada ainda.
        </div>
      ) : (
        tree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            dragOverId={dragOverId}
            setDragOverId={setDragOverId}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleActive={onToggleActive}
            onAddChild={onAddChild}
            onReparent={onReparent}
          />
        ))
      )}
    </div>
  );
}
