import React from "react";
import { Plus, FolderTree } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { useCategoriesPage } from "./useCategoriesPage.js";
import { CategoryTree } from "./components/CategoryTree.js";
import { CategoryForm } from "./components/CategoryForm.js";
import type { CreateCategoryInput, UpdateCategoryInput } from "../../api/endpoints/catalog.js";

export interface CategoriesPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function CategoriesPage(props: CategoriesPageProps) {
  if (!props.me) {
    return (
      <header className="page-head">
        <div><h1>Categorias</h1><p className="page-lead">Login necessário.</p></div>
      </header>
    );
  }

  const vm = useCategoriesPage({ merchantId: props.me.id });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Categorias</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Organize os produtos da sua loja em categorias.</div>
        </div>
        <button
          type="button"
          onClick={() => vm.startCreate()}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", font: "600 12.5px var(--sans)", color: "white", cursor: "pointer", flex: "none" }}
        >
          <Plus size={14} /> Nova categoria
        </button>
      </div>

      {vm.error ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>
          {vm.error}
        </div>
      ) : null}

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        {vm.loading ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando categorias...</div>
        ) : vm.tree.length === 0 ? (
          <div style={{ padding: "40px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--faint)" }}>
            <FolderTree size={32} />
            <strong style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>Nenhuma categoria criada.</strong>
            <p style={{ font: "12.5px var(--sans)", color: "var(--faint)" }}>Clique em "Nova categoria" para começar.</p>
          </div>
        ) : (
          <CategoryTree
            tree={vm.tree}
            onEdit={vm.startEdit}
            onDelete={vm.deleteCategory}
            onToggleActive={vm.toggleActive}
            onAddChild={(parentId) => vm.startCreate(parentId)}
            onReparent={vm.reparentCategory}
          />
        )}
      </div>

      {vm.showForm ? (
        <CategoryForm
          mode={vm.formMode}
          category={vm.editingCategory}
          parentOptions={vm.parentOptions}
          defaultParentId={vm.parentIdForCreate}
          saving={vm.saving}
          onSave={(data) => {
            if (vm.formMode === "edit" && vm.editingCategory) {
              void vm.updateCategory(vm.editingCategory.id, data as UpdateCategoryInput);
            } else {
              void vm.createCategory(data as CreateCategoryInput);
            }
          }}
          onCancel={vm.cancelForm}
        />
      ) : null}
    </div>
  );
}
