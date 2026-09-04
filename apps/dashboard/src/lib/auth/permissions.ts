import type { TabKey, NavItem } from "../../shell/nav-config.js";
import type { Role } from "./roles.js";

/**
 * Each entry lists the roles that MAY access the tab.
 * Tabs not in this map are allowed for everyone (e.g. overview, account-settings).
 * OWNER is implicit — no need to add OWNER to a list.
 */
export const PERMISSIONS: Partial<Record<TabKey, ReadonlyArray<Role>>> = {
  // Diário
  "cart-recovery": ["OWNER", "ADMIN"],
  // Vendas (configurações)
  settings: ["OWNER", "ADMIN"],
  coupons: ["OWNER", "ADMIN"],
  "cross-sell": ["OWNER", "ADMIN"],
  experiments: ["OWNER", "ADMIN"],
  "negotiation-policy": ["OWNER", "ADMIN"],
  // Catálogo
  catalog: ["OWNER", "ADMIN"],
  categories: ["OWNER", "ADMIN"],
  inventory: ["OWNER", "ADMIN"],
  delivery: ["OWNER", "ADMIN"],
  stories: ["OWNER", "ADMIN"],
  // Canais
  "agent-config": ["OWNER", "ADMIN"],
  theme: ["OWNER", "ADMIN"],
  "whatsapp-seller": ["OWNER", "ADMIN"],
  "custom-domain": ["OWNER", "ADMIN"],
  // Integrações
  "payment-connections": ["OWNER", "ADMIN"],
  integrations: ["OWNER", "ADMIN"],
  "crm-integrations": ["OWNER", "ADMIN"],
  // Inteligência IA
  "revenue-manager": ["OWNER", "ADMIN"],
  "revenue-lift": ["OWNER", "ADMIN"],
  "intent-memory": ["OWNER", "ADMIN"],
  "post-sale": ["OWNER", "ADMIN"],
  knowledge: ["OWNER", "ADMIN"],
  "m2m-agents": ["OWNER", "ADMIN"],
  // Configurações
  team: ["OWNER", "ADMIN"],
  "billing-plans": ["OWNER"],
  billing: ["OWNER"],
  chargebacks: ["OWNER", "ADMIN"],
  "audit-log": ["OWNER", "ADMIN"],
  "store-settings": ["OWNER", "ADMIN"],
  // Operations — explicit allow
  support: ["OWNER", "ADMIN", "STAFF"],
  funnel: ["OWNER", "ADMIN", "STAFF"],
  shipments: ["OWNER", "ADMIN", "STAFF"],
  customers: ["OWNER", "ADMIN", "STAFF"],
  marketplace: ["OWNER", "ADMIN", "STAFF"],
};

export function canAccessTab(role: Role | undefined, tab: TabKey): boolean {
  if (!role) return true; // defensive — pre-session should not 403
  if (role === "OWNER") return true;
  const allow = PERMISSIONS[tab];
  if (!allow) return true; // unrestricted
  return allow.includes(role);
}

export function filterNavByRole(items: NavItem[], role: Role | undefined): NavItem[] {
  return items.filter((item) => canAccessTab(role, item.key));
}
