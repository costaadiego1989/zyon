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
        onDragOver={() => setDragOverId(node.id)}
        onDragLeave={() => setDragOverId(null)}
        onDrop={(e) => {
          const draggedId = e.dataTransfer.getData("category-id");
          if (draggedId && draggedId !== node.id) {
            onReparent(draggedId, node.id);
          }
          setDragOverId(null);
        }}
      />
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
          display: "flex",
          alignItems: "center",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ flex: 1, font: "italic 600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", paddingLeft: 26 }}>NOME</div>
        <div style={{ width: 80, textAlign: "center", font: "italic 600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)" }}>PRODUTOS</div>
        <div style={{ width: 80, textAlign: "center", font: "italic 600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)" }}>STATUS</div>
        <div style={{ width: 340, textAlign: "right", font: "italic 600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", paddingRight: 4 }}></div>
      </div>

      {/* Rows */}
      {tree.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--muted)", font: "14px var(--sans)" }}>
          Nenhuma categoria criada ainda. Clique em "Nova categoria" para começar.
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
