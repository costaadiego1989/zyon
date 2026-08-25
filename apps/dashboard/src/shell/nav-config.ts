import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  Code2,
  CreditCard,
  Crown,
  KeyRound,
  Eye,
  FolderTree,
  Globe,
  Handshake,
  MessageSquare,
  Package,
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
  Tag,
  Users,
  UsersRound,
  Webhook,
  Zap,
  BarChart3,
  CircleDashed,
  TrendingUp,
  ShoppingCart,
  Smartphone,
  type LucideIcon
} from "lucide-react";

export type MerchantPlan = "STORE_ONLY" | "BOTH" | "API";

export type TabKey =
  | "onboarding"
  | "overview"
  | "integrations"
  | "shipments"
  | "customers"
  | "returns"
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
  | "catalog"
  | "product-detail"
  | "categories"
  | "store-settings"
  | "custom-domain"
  | "cross-sell"
  | "cross-sell-checkout"
  | "agent-config"
  | "agent-config-checkout"
  | "experiments"
  | "coupons"
  | "stories"
  | "team"
  | "account-settings"
  | "marketplace"
  | "whatsapp-seller"
  | "m2m-agents"
  | "checkout-protocol"
  | "checkout-programavel"
  | "intent-memory"
  | "negotiation-policy"
  | "revenue-lift"
  | "revenue-manager"
  | "cart-recovery"
  | "inventory"
  | "chargebacks";

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
  { key: "inventory", label: "Estoque", section: "Loja", icon: Package, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "stories", label: "Stories", section: "Loja", icon: CircleDashed, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "shipments", label: "Pedidos e envios", section: "Loja", icon: PackageSearch, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "returns", label: "Trocas e Devoluções", section: "Loja", icon: PackageSearch, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "customers", label: "Clientes", section: "Loja", icon: UsersRound, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "agent-config", label: "Agente IA", section: "Loja", icon: Bot, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "theme", label: "Tema", section: "Loja", icon: Palette, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "store-settings", label: "Configurações", section: "Loja", icon: Save, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "custom-domain", label: "Domínio", section: "Loja", icon: Globe, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "cross-sell", label: "Cross Sell", section: "Loja", icon: Sparkles, requiredPlan: ["STORE_ONLY", "BOTH"] },

  // ─── Checkout (Widget) ───
  { key: "settings", label: "Configurações", section: "Checkout", icon: Settings2, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "agent-config-checkout", label: "Agente IA", section: "Checkout", icon: Bot, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "cross-sell-checkout", label: "Cross Sell", section: "Checkout", icon: Sparkles, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "theme-checkout", label: "Tema", section: "Checkout", icon: Palette, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "preview", label: "Preview", section: "Checkout", icon: Eye, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "funnel", label: "Funil de conversão", section: "Checkout", icon: BarChart3, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "experiments", label: "Testes A/B", section: "Checkout", icon: Zap, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "negotiation-policy", label: "Negociação", section: "Checkout", icon: Handshake, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "checkout-programavel", label: "Checkout Programável", section: "Checkout", icon: Code2, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "coupons", label: "Cupons", section: "Checkout", icon: Tag, requiredPlan: ["STORE_ONLY", "BOTH"] },

  // ─── Integrações ───
  { key: "integrations", label: "API & Webhooks", section: "Integrações", icon: Webhook },
  { key: "payment-connections", label: "Pagamentos", section: "Integrações", icon: Zap },
  { key: "marketplace", label: "Marketplace", section: "Integrações", icon: ShoppingBag },
  { key: "whatsapp-seller", label: "WhatsApp Seller", section: "Integrações", icon: Smartphone },

  // ─── Inteligência IA ───
  { key: "intent-memory", label: "Intent Memory", section: "Inteligência IA", icon: Brain, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "revenue-lift", label: "Revenue Lift", section: "Inteligência IA", icon: TrendingUp, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "revenue-manager", label: "Revenue Manager", section: "Inteligência IA", icon: Brain, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "cart-recovery", label: "Cart Recovery", section: "Inteligência IA", icon: ShoppingCart, requiredPlan: ["STORE_ONLY", "BOTH"] },

  // ─── Conta ───
  { key: "chargebacks", label: "Chargebacks", section: "Conta", icon: AlertTriangle },
  { key: "team", label: "Equipe", section: "Conta", icon: Users },
  { key: "account-settings", label: "Configurações", section: "Conta", icon: Settings },
  { key: "billing", label: "Faturamento", section: "Conta", icon: CreditCard },
  { key: "billing-plans", label: "Planos", section: "Conta", icon: Crown },
  { key: "audit-log", label: "Auditoria", section: "Conta", icon: ShieldCheck },
  { key: "support", label: "Suporte", section: "Conta", icon: MessageSquare },
];
