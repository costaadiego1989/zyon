import React, { useEffect, useMemo, useState } from "react";
import { Plus, FolderTree, Layers, CheckCircle, PauseCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { useCategoriesPage } from "./useCategoriesPage.js";
import { CategoryTree } from "./components/CategoryTree.js";
import { CategoryForm } from "./components/CategoryForm.js";
import { StatCard } from "../overview/components/StatCard.js";
import { DataPanel } from "../../components/DataPanel.js";
import { FilterToolbar } from "../../components/FilterToolbar.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { showToast } from "../../components/Toast.js";
import type { CreateCategoryInput, UpdateCategoryInput } from "../../api/endpoints/catalog.js";
import { Button } from "../../components/Button.js";

const PAGE_SIZE = 20;

export interface CategoriesPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function CategoriesPage(props: CategoriesPageProps) {
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);

  if (!props.me) {
    return (
      <header className="page-head">
        <div><h1>Categorias</h1><p className="page-lead">Login necessário</p></div>
      </header>
    );
  }

  const vm = useCategoriesPage({ merchantId: props.me.id });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmCatName = vm.tree.find((c) => c.id === confirmDeleteId)?.name ?? "esta categoria";

  useEffect(() => {
    if (vm.error) showToast("error", vm.error);
  }, [vm.error]);

  const filteredTree = useMemo(() => {
    if (!search && !activeOnly) return vm.tree;

    function matches(name: string) {
      return name.toLowerCase().includes(search.toLowerCase());
    }

    function filterNodes(nodes: typeof vm.tree): typeof vm.tree {
      const result: typeof vm.tree = [];
      for (const node of nodes) {
        const childMatches = filterNodes(node.children);
        const selfMatch = matches(node.name) && (!activeOnly || node.is_active);
        if (selfMatch || childMatches.length > 0) {
          result.push({ ...node, children: selfMatch ? node.children : childMatches });
        }
      }
      return result;
    }

    return filterNodes(vm.tree);
  }, [vm.tree, search, activeOnly]);

  const totals = useMemo(() => {
    const total = vm.categories.length;
    const active = vm.categories.filter((c) => c.is_active).length;
    const paused = total - active;
    return { total, active, paused };
  }, [vm.categories]);

  // Paginate root nodes (children follow parent)
  const paginatedTree = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredTree.slice(start, start + PAGE_SIZE);
  }, [filteredTree, page]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [search, activeOnly]);

  return (
    <div className="page-container">
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Excluir categoria"
        description={`Tem certeza que deseja excluir "${confirmCatName}"? Produtos vinculados ficarão sem categoria.`}
        confirmLabel="Excluir"
        variant="danger"
        onConfirm={() => { vm.deleteCategory(confirmDeleteId!); setConfirmDeleteId(null); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Categorias</h1>
          <p className="page-lead">Organize os produtos da sua loja em categorias</p>
        </div>
        <Button variant="primary" size="sm" arrow onClick={() => vm.startCreate()}>
          <Plus size={14} /> Nova categoria
        </Button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard
          label="Categorias"
          value={totals.total}
          icon={<Layers size={16} />}
        />
        <StatCard
          label="Ativas"
          value={totals.active}
          icon={<CheckCircle size={16} />}
          accent="var(--color-success)"
        />
        <StatCard
          label="Pausadas"
          value={totals.paused}
          icon={<PauseCircle size={16} />}
          accent="var(--color-text-faint)"
        />
      </div>

      <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, overflow: "hidden" }}>
        {/* Filters bar */}
        <FilterToolbar
          tabs={[
            { key: "all", label: "Todos" },
            { key: "active", label: "Ativas" },
          ]}
          activeTab={activeOnly ? "active" : "all"}
          onTabChange={(k) => setActiveOnly(k === "active")}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar por nome..."
        />

        <DataPanel
          title="Categorias"
          page={page}
          pageSize={PAGE_SIZE}
          total={filteredTree.length}
          onPageChange={setPage}
          isEmpty={filteredTree.length === 0 && !vm.loading}
          empty={{ icon: FolderTree, title: "Nenhuma categoria criada", description: "Clique em 'Nova categoria' para começar a organizar seus produtos.", action: <Button variant="primary" size="sm" arrow onClick={() => vm.startCreate()}><Plus size={14} /> Nova categoria</Button> }}
        >
          {vm.loading ? (
            <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando categorias...</div>
          ) : (
            <CategoryTree
              tree={paginatedTree}
              onEdit={vm.startEdit}
              onDelete={(id) => setConfirmDeleteId(id)}
              onToggleActive={vm.toggleActive}
              onAddChild={(parentId) => vm.startCreate(parentId)}
              onReparent={vm.reparentCategory}
            />
          )}
        </DataPanel>
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
