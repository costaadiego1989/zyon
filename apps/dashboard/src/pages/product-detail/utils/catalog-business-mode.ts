import type { MerchantProfile } from "../../../api-client.js";
import type { ProductType } from "../ProductDetailPage.js";

export type CatalogBusinessMode = "products" | "services";

export function catalogBusinessMode(profile: MerchantProfile | null): CatalogBusinessMode | null {
  if (profile?.businessModeSelectionState === "review_required") return null;
  return profile?.businessMode === "products" || profile?.businessMode === "services" ? profile.businessMode : null;
}

export function productTypeMatchesBusinessMode(type: ProductType, mode: CatalogBusinessMode | null): boolean {
  return mode === "services" ? type === "service" : mode === "products" && (type === "physical" || type === "digital" || type === "food");
}

export const PRODUCT_TYPE_NAMES: Record<ProductType, string> = {
  physical: "Físico", digital: "Digital", food: "Alimentação", service: "Serviço",
};
