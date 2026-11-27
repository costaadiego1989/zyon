import type { TabKey, NavItem } from "../../shell/nav-config.js";
import type { Role } from "./roles.js";

/**
 * Each entry lists the roles that MAY access the tab.
 * Tabs not in this map are allowed for everyone (e.g. overview, account-settings).
 * OWNER is implicit — no need to add OWNER to a list.
 */
export const PERMISSIONS: Partial<Record<TabKey, ReadonlyArray<Role>>> = {
  "fiscal-settings": ["OWNER", "ADMIN"],
  "fiscal-invoices": ["OWNER", "ADMIN"],
  "fiscal-detail": ["OWNER", "ADMIN"],
  // Diário
  "cart-recovery": ["OWNER", "ADMIN"],
  finance: ["OWNER", "ADMIN"],
  // Vendas (configurações)
  settings: ["OWNER", "ADMIN"],
  coupons: ["OWNER", "ADMIN"],
  cashback: ["OWNER", "ADMIN"],
  "cross-sell": ["OWNER", "ADMIN"],
  experiments: ["OWNER", "ADMIN"],
  "negotiation-policy": ["OWNER", "ADMIN"],
  // Catálogo
  catalog: ["OWNER", "ADMIN"],
  reviews: ["OWNER", "ADMIN"],
  categories: ["OWNER", "ADMIN"],
  inventory: ["OWNER", "ADMIN"],
  delivery: ["OWNER", "ADMIN"],
  stories: ["OWNER", "ADMIN"],
  "advanced-layout": ["OWNER", "ADMIN"],
  // Canais
  "agent-config": ["OWNER", "ADMIN"],
  theme: ["OWNER", "ADMIN"],
  "whatsapp-seller": ["OWNER", "ADMIN"],
  "custom-domain": ["OWNER", "ADMIN"],
  // Integrações
  "payment-connections": ["OWNER", "ADMIN"],
  integrations: ["OWNER", "ADMIN"],
  "crm-integrations": ["OWNER", "ADMIN"],
  "erp-integrations": ["OWNER", "ADMIN"],
  // Inteligência IA
  "revenue-manager": ["OWNER", "ADMIN"],
  "meta-ads-agent": ["OWNER", "ADMIN"],
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
  "service-attendance": ["OWNER", "ADMIN"],
  "service-appointments": ["OWNER", "ADMIN"],
  customers: ["OWNER", "ADMIN", "STAFF"],
  conversations: ["OWNER", "ADMIN", "STAFF"],
  marketing: ["OWNER", "ADMIN", "STAFF"],
  marketplace: ["OWNER", "ADMIN", "STAFF"],
  "marketplace-payments": ["OWNER", "ADMIN"],
  "marketplace-shipments": ["OWNER", "ADMIN"],
  "marketplace-refunds": ["OWNER", "ADMIN"],
  "marketplace-asaas-wallet-returns": ["OWNER", "ADMIN"],
  "marketplace-contributions": ["OWNER", "ADMIN"],
  "marketplace-fees": ["OWNER", "ADMIN"],
  "marketplace-host-fees": ["OWNER", "ADMIN"],
};

export function canAccessTab(role: Role | undefined, tab: TabKey): boolean {
  if (!role) return !["fiscal-settings", "fiscal-invoices", "fiscal-detail", "conversations", "marketing"].includes(tab); // sensitive features require a resolved merchant role
  if (role === "OWNER") return true;
  const allow = PERMISSIONS[tab];
  if (!allow) return true; // unrestricted
  return allow.includes(role);
}

export function filterNavByRole(items: NavItem[], role: Role | undefined): NavItem[] {
  return items.filter((item) => canAccessTab(role, item.key));
}

export type SupportPermissionProfile = Pick<import("../../api-client.js").MerchantProfile,
  "id" | "user_id" | "role" | "businessMode" | "businessModeSelectionState">;
export type SensitiveSupportCapability = "whatsapp-conversations" | "whatsapp-configuration" | "service-attendance:manage";

const knownSupportRole = (role: unknown): role is Role => role === "OWNER" || role === "ADMIN" || role === "STAFF";
function hasPermissionProfile(profile: SupportPermissionProfile | null | undefined): profile is SupportPermissionProfile {
  return Boolean(profile && typeof profile.id === "string" && profile.id.trim()
    && typeof profile.user_id === "string" && profile.user_id.trim() && knownSupportRole(profile.role));
}

/** Conversation access follows the existing authenticated support policy.
 * It never grants connection credentials, templates or configuration. */
export function canUseWhatsAppConversations(role: unknown): boolean {
  return knownSupportRole(role) && canAccessTab(role, "support");
}
export function canConfigureWhatsApp(role: unknown): boolean {
  return knownSupportRole(role) && canAccessTab(role, "whatsapp-seller");
}

/** Management follows the existing service HTTP write allowlist, separately
 * from staff-readable availability and conversation access. Subscription
 * checks and authenticated server authorization remain separate. */
export function canManageServiceAttendance(profile: SupportPermissionProfile | null | undefined): boolean {
  return hasPermissionProfile(profile) && (profile.role === "OWNER" || profile.role === "ADMIN")
    && profile.businessMode === "services" && profile.businessModeSelectionState === "selected";
}

/** Sensitive targets opt in explicitly; never inherit the legacy unknown-tab
 * or pre-session fallback. This helper does not mount a route or a tab. */
export function canAccessSensitiveSupportCapability(profile: SupportPermissionProfile | null | undefined, capability: unknown): boolean {
  if (!hasPermissionProfile(profile)) return false;
  switch (capability) {
    case "whatsapp-conversations": return canUseWhatsAppConversations(profile.role);
    case "whatsapp-configuration": return canConfigureWhatsApp(profile.role);
    case "service-attendance:manage": return canManageServiceAttendance(profile);
    default: return false;
  }
}
