import { useMemo } from "react";
import { useApi } from "../useApi.js";

/**
 * Domain-scoped hook for catalog operations.
 *
 * Use this hook when your page needs to list, create, update, or delete products and categories.
 * It exposes only the commonly-used catalog methods, reducing the API surface your component depends on.
 *
 * For infrequent catalog operations not listed here, fall back to `useApi()` and access `api.methodName()`.
 *
 * @example
 * const catalog = useCatalogApi();
 * const products = await catalog.listProducts(merchantId);
 * const product = await catalog.getProduct(merchantId, productId);
 */
export function useCatalogApi() {
  const api = useApi();
  return useMemo(
    () => ({
      listProducts: api.listProducts,
      getProduct: api.getProduct,
      createProduct: api.createProduct,
      updateProduct: api.updateProduct,
      deleteProduct: api.deleteProduct,
      updateVariant: api.updateVariant,
      uploadProductMedia: api.uploadProductMedia,
      deleteProductMedia: api.deleteProductMedia,
      listCategories: api.listCategories,
      createCategory: api.createCategory,
      updateCategory: api.updateCategory,
      deleteCategory: api.deleteCategory,
      createPromotion: api.createPromotion,
      updatePromotion: api.updatePromotion,
      togglePromotion: api.togglePromotion,
      deletePromotion: api.deletePromotion,
      upsertProductAdvancedRules: api.upsertProductAdvancedRules,
    }),
    [api],
  );
}
