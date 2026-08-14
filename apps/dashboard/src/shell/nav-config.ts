import {
  Activity,
  Bot,
  Code2,
  CreditCard,
  KeyRound,
  Eye,
  FolderTree,
  MessageSquare,
  PackageSearch,
  Palette,
  Plug,
  Rocket,
  Save,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  UsersRound,
  Webhook,
  Zap,
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
  | "support"
  | "settings"
  | "rules"
  | "negotiation"
  | "billing"
  | "payment-connections"
  | "audit-log"
  | "commerce-connections"
  | "catalog"
  | "product-detail"
  | "categories"
  | "store-settings"
  | "agent-config";

export const NAV_ITEMS: Array<{
  key: TabKey;
  label: string;
  section: string;
  icon: LucideIcon;
  requiredPlan?: MerchantPlan | MerchantPlan[];
}> = [
  { key: "onboarding", label: "Primeiros passos", section: "Começar", icon: Rocket },
  { key: "overview", label: "Operação", section: "Hoje", icon: Activity },
  { key: "shipments", label: "Pedidos e envios", section: "Hoje", icon: PackageSearch },
  { key: "customers", label: "Clientes", section: "Hoje", icon: UsersRound },
  { key: "funnel", label: "Funil de conversão", section: "Hoje", icon: Activity },
  { key: "integrations", label: "Desenvolvedores", section: "Plataforma", icon: Webhook, requiredPlan: "CHECKOUT_ONLY" },
  { key: "commerce-connections", label: "Loja / Commerce", section: "Plataforma", icon: Store, requiredPlan: "STORE_ONLY" },
  { key: "embed", label: "Embed", section: "Plataforma", icon: Code2, requiredPlan: "CHECKOUT_ONLY" },
  { key: "theme", label: "Tema", section: "Plataforma", icon: Palette },
  { key: "preview", label: "Preview", section: "Plataforma", icon: Eye, requiredPlan: "CHECKOUT_ONLY" },
  { key: "support", label: "Suporte", section: "Atendimento", icon: MessageSquare },
  { key: "settings", label: "Checkout", section: "Atendimento", icon: Settings2, requiredPlan: "CHECKOUT_ONLY" },
  { key: "rules", label: "Agente", section: "Atendimento", icon: Bot, requiredPlan: "CHECKOUT_ONLY" },
  { key: "negotiation", label: "Negociação", section: "Atendimento", icon: SlidersHorizontal, requiredPlan: "CHECKOUT_ONLY" },
  { key: "billing", label: "Faturamento", section: "Conta", icon: CreditCard },
  { key: "payment-connections", label: "Pagamentos", section: "Conta", icon: Zap },
  { key: "audit-log", label: "Auditoria", section: "Conta", icon: ShieldCheck },
  { key: "catalog", label: "Catálogo", section: "Loja", icon: ShoppingBag, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "categories", label: "Categorias", section: "Loja", icon: FolderTree, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "store-settings", label: "Configurações da loja", section: "Loja", icon: Save, requiredPlan: ["STORE_ONLY", "BOTH"] },
  { key: "agent-config", label: "Agente da loja", section: "Loja", icon: Plug, requiredPlan: ["STORE_ONLY", "BOTH"] },
];
