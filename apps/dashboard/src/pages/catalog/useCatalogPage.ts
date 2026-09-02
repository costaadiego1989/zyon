import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MerchantProfile, Product } from "../../api-client.js";
import { useCatalogApi } from "../../hooks/api/useCatalogApi.js";
import { usePlanFeatures } from "../../hooks/api/usePlanFeatures.js";
import type { CsvRow } from "../../components/CsvImportModal.js";
import { useImportProgress } from "../../components/spreadsheet-import/ImportProgressProvider.js";

export type StatusFilter = "all" | "active" | "inactive";

export function totalStock(product: Product): number {
  return product.variants.reduce(
    (sum, v) => sum + (v.stockQuantity ?? 0) - (v.stockReserved ?? 0),
    0,
  );
}

export interface UseCatalogPageArgs {
  me: MerchantProfile | null;
}

export interface CatalogPageVM {
  // data
  items: Product[];
  filteredItems: Product[];
  total: number;
  categories: Array<{ id: string; name: string }>;
  totals: { total: number; inStock: number; inactive: number };
  // status
  loading: boolean;
  error: string | null;
  pageError: string | null;
  deletingId: string | null;
  togglingId: string | null;
  deleteTarget: Product | null;
  // filters + pagination
  search: string;
  setSearch: (v: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  page: number;
  setPage: (v: number) => void;
  pageSize: number;
  // ui
  hoveredRow: string | null;
  setHoveredRow: (v: string | null) => void;
  showCsvModal: boolean;
  setShowCsvModal: (v: boolean) => void;
  // background AI imports (now backed by global ImportProgressProvider)
  onImportStarted: (jobId: string, fileName: string) => void;
  // actions
  confirmDelete: (product: Product) => void;
  cancelDelete: () => void;
  executeDelete: () => Promise<void>;
  toggleActive: (product: Product) => Promise<void>;
  handleCsvImport: (rows: CsvRow[]) => Promise<void>;
  reload: () => Promise<void>;
  aiImportEnabled: boolean;
}

const PAGE_SIZE = 20;

export function useCatalogPage({ me }: UseCatalogPageArgs): CatalogPageVM {
  const catalog = useCatalogApi();
  const { hasFeature } = usePlanFeatures();
  const aiImportEnabled = hasFeature("aiSpreadsheetImport");
  const { imports, startImport } = useImportProgress();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const merchantId = me?.id;

  useEffect(() => {
    if (!merchantId) return;
    catalog.listCategories?.(merchantId).then(setCategories).catch(() => {});
  }, [catalog, merchantId]);

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await catalog.listProducts(merchantId, {
        query: search || undefined,
        categoryId: categoryFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setItems(result.products);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [catalog, merchantId, search, categoryFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, statusFilter]);

  // Refresh product list when a tracked import finishes. The provider owns the
  // banner + toasts; we just observe completed transitions.
  const seenCompletedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let mutated = false;
    for (const job of imports) {
      if (job.status === "completed") {
        if (!seenCompletedRef.current.has(job.jobId)) {
          seenCompletedRef.current.add(job.jobId);
          mutated = true;
        }
      }
    }
    if (mutated) void load();
  }, [imports, load]);

  const filteredItems = useMemo(() => {
    if (statusFilter === "all") return items;
    if (statusFilter === "active") return items.filter((p) => p.isActive);
    return items.filter((p) => !p.isActive);
  }, [items, statusFilter]);

  const totals = useMemo(() => {
    const totalCount = total;
    const inStock = filteredItems.filter((p) => totalStock(p) > 0).length;
    const inactive = filteredItems.filter((p) => !p.isActive).length;
    return { total: totalCount, inStock, inactive };
  }, [filteredItems, total]);

  const confirmDelete = useCallback((product: Product) => {
    setDeleteTarget(product);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const executeDelete = useCallback(async () => {
    if (!deleteTarget || !merchantId) return;
    setDeletingId(deleteTarget.id);
    setDeleteTarget(null);
    setPageError(null);
    try {
      await catalog.deleteProduct(merchantId, deleteTarget.id);
      await load();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }, [catalog, deleteTarget, merchantId, load]);

  const toggleActive = useCallback(async (product: Product) => {
    if (!merchantId) return;
    setTogglingId(product.id);
    setPageError(null);
    try {
      await catalog.updateProduct(merchantId, product.id, { isActive: !product.isActive });
      await load();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setTogglingId(null);
    }
  }, [catalog, merchantId, load]);

  const handleCsvImport = useCallback(async (rows: CsvRow[]) => {
    if (!merchantId) throw new Error("Merchant ID não disponível");

    setPageError(null);

    for (const row of rows) {
      try {
        await catalog.createProduct(merchantId, {
          name: row.name,
          description: row.description || undefined,
          categoryId: row.category ? row.category : undefined,
          variants: [{
            sku: row.sku,
            basePriceInCents: Math.round(row.price * 100),
            stockQuantity: row.stock ?? 0,
            weightGrams: row.weight_grams,
            lengthCm: row.length_cm,
            widthCm: row.width_cm,
            heightCm: row.height_cm,
          }],
        });
      } catch {
        // Continue importing remaining rows
      }
    }

    await load();
  }, [catalog, merchantId, load]);

  const onImportStarted = useCallback(
    (jobId: string, fileName: string) => {
      if (!merchantId) return;
      startImport(jobId, fileName, merchantId);
    },
    [startImport, merchantId],
  );

  return {
    items,
    filteredItems,
    total,
    categories,
    totals,
    loading,
    error,
    pageError,
    deletingId,
    togglingId,
    deleteTarget,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    hoveredRow,
    setHoveredRow,
    showCsvModal,
    setShowCsvModal,
    onImportStarted,
    confirmDelete,
    cancelDelete,
    executeDelete,
    toggleActive,
    handleCsvImport,
    reload: load,
    aiImportEnabled,
  };
}
