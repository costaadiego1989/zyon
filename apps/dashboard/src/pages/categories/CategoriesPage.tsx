import React, { useEffect, useMemo, useState } from "react";
import { Plus, FolderTree, Layers, CheckCircle, PauseCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { useCategoriesPage } from "./useCategoriesPage.js";
import { CategoryTree } from "./components/CategoryTree.js";
import { CategoryForm } from "./components/CategoryForm.js";
import { StatCard } from "../overview/components/StatCard.js";
import { Pagination } from "../../components/Pagination.js";
import { FilterToolbar } from "../../components/FilterToolbar.js";
import type { CreateCategoryInput, UpdateCategoryInput } from "../../api/endpoints/catalog.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";

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
        <div><h1>Categorias</h1><p className="page-lead">Login necessário.</p></div>
      </header>
    );
  }

  const vm = useCategoriesPage({ merchantId: props.me.id });

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
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Categorias</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Organize os produtos da sua loja em categorias.</div>
        </div>
        <Button variant="primary" size="sm" arrow onClick={() => vm.startCreate()}>
          <Plus size={14} /> Nova categoria
        </Button>
      </div>

      {vm.error ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>
          {vm.error}
        </div>
      ) : null}

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
          accent="var(--good)"
        />
        <StatCard
          label="Pausadas"
          value={totals.paused}
          icon={<PauseCircle size={16} />}
          accent="var(--faint)"
        />
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
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

        {vm.loading ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando categorias...</div>
        ) : filteredTree.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title="Nenhuma categoria criada"
            description="Clique em 'Nova categoria' para começar a organizar seus produtos."
            action={<Button variant="primary" size="sm" arrow onClick={() => vm.startCreate()}><Plus size={14} /> Nova categoria</Button>}
          />
        ) : (
          <CategoryTree
            tree={paginatedTree}
            onEdit={vm.startEdit}
            onDelete={vm.deleteCategory}
            onToggleActive={vm.toggleActive}
            onAddChild={(parentId) => vm.startCreate(parentId)}
            onReparent={vm.reparentCategory}
          />
        )}
      </div>

      {filteredTree.length > PAGE_SIZE && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={filteredTree.length}
          onChange={setPage}
          disabled={vm.loading}
        />
      )}

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
