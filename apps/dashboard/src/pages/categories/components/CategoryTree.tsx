import React, { useState } from "react";
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

function renderNodes(
  nodes: CategoryTreeNode[],
  depth: number,
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
      rows.push(...renderNodes(node.children, depth + 1, dragOverId, setDragOverId, onEdit, onDelete, onToggleActive, onAddChild, onReparent));
    }
  }
  return rows;
}

export function CategoryTree({ tree, onEdit, onDelete, onToggleActive, onAddChild, onReparent }: CategoryTreeProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <div
      style={{ background: "var(--card)", overflow: "hidden" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("category-id");
        if (id) onReparent(id, null);
        setDragOverId(null);
      }}
      onDragEnd={() => setDragOverId(null)}
    >
      {tree.length === 0 ? (
        <div style={{ padding: "48px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--faint)" }}>
          <strong style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>Nenhuma categoria cadastrada.</strong>
          <p style={{ font: "12.5px var(--sans)", color: "var(--faint)" }}>Clique em "Nova categoria" para começar.</p>
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["NOME", "PRODUTOS", "STATUS", ""].map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", borderBottom: "1px solid var(--border)" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renderNodes(tree, 0, dragOverId, setDragOverId, onEdit, onDelete, onToggleActive, onAddChild, onReparent)}
          </tbody>
        </table>
      )}
    </div>
  );
}
