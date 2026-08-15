import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
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
    setLoading(true);
    setError(null);
    try {
      const data = await api.listCategories(props.merchantId);
      setCategories(data as ProductCategoryDTO[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api, props.merchantId]);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  const createCategory = useCallback(async (data: CreateCategoryInput) => {
    setSaving(true);
    setError(null);
    try {
      await api.createCategory(props.merchantId, data);
      setShowForm(false);
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [api, props.merchantId, fetchCategories]);

  const updateCategory = useCallback(async (id: string, data: UpdateCategoryInput) => {
    setSaving(true);
    setError(null);
    try {
      await api.updateCategory(props.merchantId, id, data);
      setShowForm(false);
      setEditingCategory(null);
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [api, props.merchantId, fetchCategories]);

  const deleteCategory = useCallback(async (id: string) => {
    const ok = window.confirm("Remover esta categoria? Esta ação não pode ser desfeita.");
    if (!ok) return;
    setError(null);
    try {
      await api.deleteCategory(props.merchantId, id);
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, props.merchantId, fetchCategories]);

  const toggleActive = useCallback(async (id: string, isActive: boolean) => {
    setError(null);
    try {
      await api.updateCategory(props.merchantId, id, { is_active: !isActive });
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, props.merchantId, fetchCategories]);

  const reparentCategory = useCallback(async (categoryId: string, newParentId: string | null) => {
    if (categoryId === newParentId) return;
    const descendants = getDescendantIds(categories, categoryId);
    if (newParentId && descendants.has(newParentId)) return;

    setError(null);
    try {
      await api.updateCategory(props.merchantId, categoryId, { parent_id: newParentId });
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, props.merchantId, categories, fetchCategories]);

  const startEdit = useCallback((category: ProductCategoryDTO) => {
    setEditingCategory(category);
    setFormMode("edit");
    setShowForm(true);
  }, []);

  const startCreate = useCallback((parentId?: string) => {
    setEditingCategory(null);
    setFormMode("create");
    setParentIdForCreate(parentId);
    setShowForm(true);
  }, []);

  const cancelForm = useCallback(() => {
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
