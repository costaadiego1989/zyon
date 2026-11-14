import type { ProductContentPurchaseResponse } from "@/lib/api/product-content";

/** Catalog facts only: no generated discounts, efficacy claims or invented delivery promises. */
export function buildProductNarration(purchase: ProductContentPurchaseResponse): string {
  const plain = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const name = plain(purchase.productName).slice(0, 160);
  const description = plain(purchase.description ?? "");
  const available = purchase.variants.filter((variant) => variant.available);
  const optionFact = purchase.optionGroups.length || available.length > 1 ? "Há versões disponíveis." : "";
  // The Realtime instruction has the same 45-word ceiling. Keeping the source
  // below it prevents the model from truncating or paraphrasing the end.
  return limitWords([name + ".", description, optionFact].filter(Boolean).join(" "), 45);
}

function limitWords(value: string, maximum: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maximum) return words.join(" ");
  return words.slice(0, maximum).join(" ") + "…";
}
