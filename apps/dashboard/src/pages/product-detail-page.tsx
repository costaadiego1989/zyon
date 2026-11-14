// Barrel re-export for backward compatibility
export {
  ProductDetailPage,
  type ProductDetailPageProps,
  type ProductMetadata,
  type ProductType,
  centsToReais,
  reaisToCents,
  formatCurrencyInput,
} from "./product-detail/ProductDetailPage.js";

// Export hooks and types for tests/consumers
export { emptyVariant, type ProductVariantDraft } from "./product-detail/hooks/useVariantManager.js";
export { validateVariants, parseInteger, parseFloatSafe } from "./product-detail/utils/product-validation.js";
