export function productIdFromHash(hash: string): string | null {
  const [route, query] = hash.replace(/^#/, "").split("?");
  return route === "product-detail" ? new URLSearchParams(query ?? "").get("productId") || null : null;
}

export function productEditorHash(productId?: string | null): string {
  return `product-detail${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`;
}
