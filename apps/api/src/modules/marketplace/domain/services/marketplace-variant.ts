const ATTR_LABELS: Record<string, string> = { color: "Cor", size: "Tamanho", material: "Material", weight: "Peso", style: "Estilo", flavor: "Sabor", voltage: "Voltagem", capacity: "Capacidade", model: "Modelo", edition: "Edição", pack: "Pacote", type: "Tipo", format: "Formato" };

function publicText(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, limit);
}

export function marketplaceVariantAttributesLabel(attributes: unknown): string {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return "";
  return Object.entries(attributes).filter(([, value]) => typeof value === "string" || typeof value === "number" && Number.isFinite(value))
    .sort(([a], [b]) => a.localeCompare(b)).slice(0, 6)
    .map(([key, value]) => {
      const label = publicText(ATTR_LABELS[key.toLowerCase()] ?? key, 40), text = publicText(String(value), 64);
      return label && text ? `${label}: ${text}` : "";
    }).filter(Boolean).join(" · ").slice(0, 180);
}

export function marketplaceVariantLabel(attributes: unknown, sku: string): string {
  return marketplaceVariantAttributesLabel(attributes) || publicText(sku, 180) || "Opção";
}

export function isMarketplaceVariantPrice(value: unknown, currency: unknown): value is number {
  return currency === "BRL" && typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

export function marketplaceVariantInStock(type: string, stock: Array<{ quantity: number; reserved: number }>): boolean {
  return ["digital", "service"].includes(type) || stock.some(row => Number.isSafeInteger(row.quantity) && row.quantity >= 0
    && Number.isSafeInteger(row.reserved) && row.reserved >= 0 && row.quantity - row.reserved >= 1);
}
