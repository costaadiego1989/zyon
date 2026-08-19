import {
  Activity,
  Bot,
  Code2,
  CreditCard,
  Crown,
  KeyRound,
  Eye,
  FolderTree,
  Globe,
  MessageSquare,
  PackageSearch,
  Palette,
  Plug,
  Rocket,
  Save,
  Settings,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
  UsersRound,
  Webhook,
  Zap,
  BarChart3,
  CircleDashed,
  type LucideIcon
} from "lucide-react";

export type MerchantPlan = "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH";

export type TabKey =
  | "onboarding"
  | "overview"
  | "integrations"
  | "shipments"
  | "customers"
  | "funnel"
  | "embed"
  | "preview"
  | "theme"
  | "theme-checkout"
  | "support"
  | "settings"
  | "rules"
  | "billing"
  | "billing-plans"
  | "payment-connections"
  | "audit-log"
  | "commerce-connections"
  | "catalog"
  | "product-detail"
  | "categories"
  | "store-settings"
  | "custom-domain"
  | "cross-sell"
  | "cross-sell-checkout"
  | "agent-config"
  | "agent-config-checkout"
  | "stories"
  | "team"
  | "account-settings"
  | "marketplace";

export const NAV_ITEMS: Array<{
  key: TabKey;
  label: string;
  section: string;
  icon: LucideIcon;
  requiredPlan?: MerchantPlan | MerchantPlan[];
}> = [
  // ─── Início ───
  { key: "onboarding", label: "Primeiros passos", section: "Início", icon: Rocket },
  { key: "overview", label: "Visão geral", section: "Início", icon: Activity },

  // ─── Loja (Storefront) ───
  { key: "catalog", label: "Catálogo", section: "Loja", icon: ShoppingBag, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "categories", label: "Categorias", section: "Loja", icon: FolderTree, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "stories", label: "Stories", section: "Loja", icon: CircleDashed, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "shipments", label: "Pedidos e envios", section: "Loja", icon: PackageSearch, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "customers", label: "Clientes", section: "Loja", icon: UsersRound, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "agent-config", label: "Agente IA", section: "Loja", icon: Bot, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "theme", label: "Tema", section: "Loja", icon: Palette, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "store-settings", label: "Configurações", section: "Loja", icon: Save, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "custom-domain", label: "Domínio", section: "Loja", icon: Globe, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "cross-sell", label: "Cross Sell", section: "Loja", icon: Sparkles, requiredPlan: ["STORE_ONLY", "BOTH"] },

  // ─── Checkout (Widget) ───
  { key: "settings", label: "Configurações", section: "Checkout", icon: Settings2, requiredPlan: ["CHECKOUT_ONLY", "BOTH"] },
  { key: "agent-config-checkout", label: "Agente IA", section: "Checkout", icon: Bot, requiredPlan: ["CHECKOUT_ONLY", "BOTH"] },
  { key: "cross-sell-checkout", label: "Cross Sell", section: "Checkout", icon: Sparkles, requiredPlan: ["CHECKOUT_ONLY", "BOTH"] },
  { key: "theme-checkout", label: "Tema", section: "Checkout", icon: Palette, requiredPlan: ["CHECKOUT_ONLY"] },
  { key: "preview", label: "Preview", section: "Checkout", icon: Eye, requiredPlan: ["CHECKOUT_ONLY", "STORE_ONLY", "BOTH"] },
  { key: "funnel", label: "Funil de conversão", section: "Checkout", icon: BarChart3, requiredPlan: ["CHECKOUT_ONLY", "BOTH"] },

  // ─── Integrações ───
  { key: "integrations", label: "Desenvolvedores", section: "Integrações", icon: Webhook },
  { key: "commerce-connections", label: "Commerce", section: "Integrações", icon: Store },
  { key: "payment-connections", label: "Pagamentos", section: "Integrações", icon: Zap },
  { key: "marketplace", label: "Marketplace", section: "Integrações", icon: ShoppingBag },

  // ─── Conta ───
  { key: "team", label: "Equipe", section: "Conta", icon: Users },
  { key: "account-settings", label: "Configurações", section: "Conta", icon: Settings },
  { key: "billing", label: "Faturamento", section: "Conta", icon: CreditCard },
  { key: "billing-plans", label: "Planos", section: "Conta", icon: Crown },
  { key: "audit-log", label: "Auditoria", section: "Conta", icon: ShieldCheck },
  { key: "support", label: "Suporte", section: "Conta", icon: MessageSquare },
];
