import React, { useState } from "react";
import { ChevronRight, ChevronDown, Plus } from "lucide-react";
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

interface TreeNodeProps {
  node: CategoryTreeNode;
  depth: number;
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
  onEdit: (category: ProductCategoryDTO) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onAddChild: (parentId: string) => void;
  onReparent: (categoryId: string, newParentId: string | null) => void;
}

function TreeNode({ node, depth, dragOverId, setDragOverId, onEdit, onDelete, onToggleActive, onAddChild, onReparent }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", padding: "0 22px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ width: depth * 24, flex: "none" }} />
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: 0, flex: "none" }}
            aria-label={expanded ? "Recolher" : "Expandir"}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <div style={{ width: 20, flex: "none" }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <CategoryRow
            category={node}
            isDropTarget={dragOverId === node.id}
            onEdit={() => onEdit(node)}
            onDelete={() => onDelete(node.id)}
            onToggleActive={() => onToggleActive(node.id, node.is_active)}
            onDragStart={(e) => {
              e.dataTransfer.setData("category-id", node.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverId(node.id);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const draggedId = e.dataTransfer.getData("category-id");
              if (draggedId && draggedId !== node.id) {
                onReparent(draggedId, node.id);
              }
              setDragOverId(null);
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => onAddChild(node.id)}
          title="Adicionar subcategoria"
          style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer", color: "var(--faint)", flex: "none", marginLeft: 6 }}
        >
          <Plus size={12} />
        </button>
      </div>
      {expanded && hasChildren ? (
        node.children.map((child) => (
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
      ) : null}
    </>
  );
}

export function CategoryTree({ tree, onEdit, onDelete, onToggleActive, onAddChild, onReparent }: CategoryTreeProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("category-id");
        if (id) onReparent(id, null);
        setDragOverId(null);
      }}
      onDragEnd={() => setDragOverId(null)}
    >
      <div style={{ display: "flex", alignItems: "center", padding: "10px 22px", borderBottom: "1px solid var(--border)" }}>
        {["NOME", "STATUS", "PRODUTOS", "AÇÕES"].map((label, i) => (
          <div
            key={label}
            style={{
              font: "600 10.5px var(--mono)",
              letterSpacing: "0.05em",
              color: "var(--faint)",
              flex: i === 0 ? 1 : "none",
              width: i === 1 ? 80 : i === 2 ? 80 : i === 3 ? 140 : undefined,
              textAlign: i > 0 ? "center" : "left",
              paddingLeft: i === 0 ? 42 : 0,
            }}
          >
            {label}
          </div>
        ))}
      </div>
      {tree.map((node) => (
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
      ))}
      {dragOverId === null && (
        <div
          style={{
            padding: "8px 22px",
            font: "11px var(--sans)",
            color: "var(--faint)",
            textAlign: "center",
            opacity: 0,
            pointerEvents: "none",
          }}
        >
          Solte aqui para mover para o nível raiz
        </div>
      )}
    </div>
  );
}
