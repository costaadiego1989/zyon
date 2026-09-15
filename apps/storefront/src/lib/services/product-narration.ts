import type { ProductContentPurchaseResponse } from "@/lib/api/product-content";

/** Catalog facts only: no generated discounts, efficacy claims or invented delivery promises. */
export function buildProductNarration(purchase: ProductContentPurchaseResponse): string {
  const plain = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const name = plain(purchase.productName).slice(0, 160);
  const description = plain(purchase.description ?? "");
  const shortDescription = description.length <= 240 ? description : description.slice(0, 237).replace(/\s+\S*$/, "") + "…";
  const available = purchase.variants.filter((variant) => variant.available);
  const optionHint = purchase.optionGroups.length ? "Você pode montar seu pedido com as opções abaixo." : available.length > 1 ? "Escolha a versão que combina com você." : "";
  return [name + ".", shortDescription, optionHint, "Explore os detalhes enquanto eu te acompanho. Se precisar, é só voltar à conversa."]
    .filter(Boolean).join(" ");
}
