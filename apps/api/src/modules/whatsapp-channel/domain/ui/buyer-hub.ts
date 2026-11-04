import type { StoreUiAction } from "./meta-ui.types.js";

/** The menu, help and command resolver share this executable registry. */
export const BUYER_HUB_COMMANDS = [
  { command: "/comprarapida", label: "⚡ Compra rápida", message: "Finalizar compra", tool: "checkout" },
  { command: "/carrinho", label: "🛒 Meu carrinho", message: "Ver carrinho", tool: "get_cart" },
  { command: "/produtos", label: "🛍️ Ver produtos", message: "Ver produtos", tool: "search_products" },
  { command: "/categorias", label: "🗂️ Categorias", message: "Categorias", tool: "list_categories" },
  { command: "/ofertas", label: "🏷️ Ofertas", message: "Ofertas", tool: "get_daily_deals" },
  { command: "/favoritos", label: "❤️ Meus favoritos", message: "Lista de desejos", tool: "get_wishlist", protected: true },
  { command: "/dados", label: "👤 Meus dados", protected: true },
  { command: "/enderecos", label: "📍 Meus endereços", protected: true },
  { command: "/ajuda", label: "💬 Ajuda da loja", message: "Quero tirar uma dúvida sobre a loja" },
] as const;

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function buyerHubCommand(message: string): string | undefined {
  const key = normalize(message);
  if (["/atalho", "/atalhos"].includes(key)) return "/atalhos";
  if (key === "/cancelar") return key;
  return BUYER_HUB_COMMANDS.find(entry => normalize(entry.command) === key || normalize(entry.label) === key)?.command;
}
export function buyerHubRoute(command: string): { message: string; action?: StoreUiAction } | undefined {
  const entry = BUYER_HUB_COMMANDS.find(entry => entry.command === command);
  if (!entry || !("message" in entry)) return;
  return { message: entry.message, ...("tool" in entry ? { action: { kind: "tool" as const, tool: entry.tool,
    args: entry.tool === "search_products" ? { query: "*" } : {} } } : {}) };
}
export const HUB_ADDRESS_FIELDS = ["label", "zip", "street", "number", "complement", "neighborhood", "city", "state"] as const;
export type HubAddressField = typeof HUB_ADDRESS_FIELDS[number];
export interface BuyerHubState {
  merchantId: string; conversationId: string; buyerId: string; token: string; expiresAt: number;
  mode: "addresses" | "address" | "add" | "edit" | "delete";
  basisHash: string; addressId?: string; field?: HubAddressField;
  draft?: Partial<Record<HubAddressField, string>>;
}
