import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { ProductCategoryDTO, CreateCategoryInput, UpdateCategoryInput } from "../../api/endpoints/catalog.js";

export interface CategoryTreeNode extends ProductCategoryDTO {
  children: CategoryTreeNode[];
}

function buildTree(flat: ProductCategoryDTO[]): CategoryTreeNode[] {
  const map = new Map<string, CategoryTreeNode>();
  const roots: CategoryTreeNode[] = [];

  for (const cat of flat) {
    map.set(cat.id, { ...cat, children: [] });
  }
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortFn = (a: CategoryTreeNode, b: CategoryTreeNode) => a.sort_order - b.sort_order;
  roots.sort(sortFn);
  for (const node of map.values()) node.children.sort(sortFn);
  return roots;
}

function getDescendantIds(categories: ProductCategoryDTO[], id: string): Set<string> {
  const ids = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.pop()!;
    for (const cat of categories) {
      if (cat.parent_id === current && !ids.has(cat.id)) {
        ids.add(cat.id);
        queue.push(cat.id);
      }
    }
  }
  return ids;
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function useCategoriesPage(props: { merchantId: string }) {
  const api = useApi();
  const [categories, setCategories] = useState<ProductCategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<ProductCategoryDTO | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [saving, setSaving] = useState(false);
  const [parentIdForCreate, setParentIdForCreate] = useState<string | undefined>(undefined);

  const tree = useMemo(() => buildTree(categories), [categories]);

  const fetchCategories = useCallback(async () => {
    if (!props.merchantId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await api.listCategories(props.merchantId);
      setCategories(data as ProductCategoryDTO[]);
    } catch (e) {
      setError("Não foi possível carregar as categorias. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [api, props.merchantId]);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const mutation = useRef(false);

  async function mutate(action: () => Promise<unknown>, scope: "form" | "list", success: string) {
    if (mutation.current) return false;
    mutation.current = true;
    setMutating(true);
    setSaving(scope === "form");
    const setFailure = scope === "form" ? setFormError : setActionError;
    setFailure(null);
    try {
      await action();
      if (scope === "form") { setShowForm(false); setEditingCategory(null); }
      showToast("success", success);
      await fetchCategories();
      return true;
    } catch {
      setFailure(scope === "form"
        ? "Não foi possível salvar a categoria. Seus dados foram mantidos. Tente novamente."
        : "Não foi possível atualizar a categoria. Tente novamente.");
      return false;
    } finally {
      mutation.current = false;
      setMutating(false);
      setSaving(false);
    }
  }
  const createCategory = (data: CreateCategoryInput) => mutate(() => api.createCategory(props.merchantId, data), "form", "Categoria criada");
  const updateCategory = (id: string, data: UpdateCategoryInput) => mutate(() => api.updateCategory(props.merchantId, id, data), "form", "Categoria salva");
  const deleteCategory = (id: string) => mutate(() => api.deleteCategory(props.merchantId, id), "list", "Categoria excluída");
  const toggleActive = (id: string, active: boolean) => mutate(async () => {
    await api.updateCategory(props.merchantId, id, { is_active: !active });
    setCategories(current => current.map(category => category.id === id ? { ...category, is_active: !active } : category));
  }, "list", active ? "Categoria pausada" : "Categoria ativada");
  async function reparentCategory(id: string, parentId: string | null) {
    if (id === parentId || (parentId && getDescendantIds(categories, id).has(parentId))) return;
    await mutate(() => api.updateCategory(props.merchantId, id, { parent_id: parentId }), "list", "Organização atualizada");
  }

  const startEdit = useCallback((category: ProductCategoryDTO) => {
    setFormError(null);
    setEditingCategory(category);
    setFormMode("edit");
    setShowForm(true);
  }, []);

  const startCreate = useCallback((parentId?: string) => {
    setFormError(null);
    setEditingCategory(null);
    setFormMode("create");
    setParentIdForCreate(parentId);
    setShowForm(true);
  }, []);

  const cancelForm = useCallback(() => {
    if (mutation.current) return;
    setShowForm(false);
    setEditingCategory(null);
    setParentIdForCreate(undefined);
  }, []);

  const parentOptions = useMemo(() => {
    if (formMode === "edit" && editingCategory) {
      const excluded = getDescendantIds(categories, editingCategory.id);
      excluded.add(editingCategory.id);
      return categories.filter((c) => !excluded.has(c.id));
    }
    return categories;
  }, [categories, formMode, editingCategory]);

  return {
    categories,
    formError, actionError, mutating, clearActionError: () => setActionError(null),
    loading,
    error,
    editingCategory,
    showForm,
    formMode,
    saving,
    tree,
    parentIdForCreate,
    parentOptions,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    toggleActive,
    reparentCategory,
    startEdit,
    startCreate,
    cancelForm,
  };
}
