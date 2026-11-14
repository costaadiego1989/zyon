import React, { useState } from "react";
import type { CategoryTreeNode } from "../useCategoriesPage.js";
import type { ProductCategoryDTO } from "../../../api/endpoints/catalog.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { CategoryRow } from "./CategoryRow.js";

interface CategoryTreeProps {
  tree: CategoryTreeNode[];
  disabled?: boolean;
  onEdit: (category: ProductCategoryDTO) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onAddChild: (parentId: string) => void;
  onReparent: (categoryId: string, newParentId: string | null) => void;
}

function renderNodes(
  nodes: CategoryTreeNode[],
  depth: number,
  disabled: boolean,
  dragOverId: string | null,
  setDragOverId: (id: string | null) => void,
  onEdit: (cat: ProductCategoryDTO) => void,
  onDelete: (id: string) => void,
  onToggleActive: (id: string, isActive: boolean) => void,
  onAddChild: (parentId: string) => void,
  onReparent: (categoryId: string, newParentId: string | null) => void,
): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  for (const node of nodes) {
    rows.push(
      <CategoryRow
        key={node.id}
        category={node}
        disabled={disabled}
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
    );
    if (node.children && node.children.length > 0) {
      rows.push(...renderNodes(node.children, depth + 1, disabled, dragOverId, setDragOverId, onEdit, onDelete, onToggleActive, onAddChild, onReparent));
    }
  }
  return rows;
}

export function CategoryTree({ tree, disabled = false, onEdit, onDelete, onToggleActive, onAddChild, onReparent }: CategoryTreeProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <div
      className="categories-table"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("category-id");
        if (id && !disabled) onReparent(id, null);
        setDragOverId(null);
      }}
      onDragEnd={() => setDragOverId(null)}
    >
      {tree.length === 0 ? (
        <EmptyState title="Nenhuma categoria cadastrada" description={'Clique em "Nova categoria" para começar.'} />
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Nome", "Produtos", "Status", "Ações"].map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renderNodes(tree, 0, disabled, dragOverId, setDragOverId, onEdit, onDelete, onToggleActive, onAddChild, onReparent)}
          </tbody>
        </table>
      )}
    </div>
  );
}
