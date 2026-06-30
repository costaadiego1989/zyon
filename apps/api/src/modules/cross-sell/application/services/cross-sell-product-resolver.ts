import type { CartItem, SuggestedProduct } from "@zyon/shared-types";

const CATALOG: Record<string, Omit<CartItem, "sku" | "quantity">> = {
  "NECS-001": {
    name: "Necessaire Executiva",
    price: 49.9,
    cost: 18,
    category: "acessorios",
    variant: "preta"
  },
  "NECS-002": {
    name: "Necessaire Compacta",
    price: 39.9,
    cost: 14,
    category: "acessorios",
    variant: "grafite"
  },
  "CART-COE-01": {
    name: "Carteira Slim RFID",
    price: 89.9,
    cost: 34,
    category: "acessorios",
    variant: "couro"
  }
};

export function resolveCrossSellProduct(sku: string, suggestionId?: string): SuggestedProduct & { suggestion_id?: string } {
  const item = CATALOG[sku] ?? {
    name: humanizeSku(sku),
    price: 59.9,
    cost: 24,
    category: "complemento"
  };

  return {
    suggestion_id: suggestionId,
    sku,
    name: item.name,
    unit_price: item.price,
    category: item.category,
    variant: item.variant,
    image_url: item.imageUrl,
    product_url: item.productUrl
  };
}

export function resolveCrossSellCartItem(sku: string): CartItem {
  const item = CATALOG[sku] ?? {
    name: humanizeSku(sku),
    price: 59.9,
    cost: 24,
    category: "complemento"
  };

  return {
    sku,
    name: item.name,
    price: item.price,
    cost: item.cost,
    quantity: 1,
    category: item.category,
    variant: item.variant,
    imageUrl: item.imageUrl,
    productUrl: item.productUrl
  };
}

function humanizeSku(sku: string): string {
  return sku
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Produto complementar";
}
