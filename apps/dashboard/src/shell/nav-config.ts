import {
  Activity,
  Bot,
  Code2,
  CreditCard,
  KeyRound,
  Eye,
  MessageSquare,
  PackageSearch,
  Palette,
  Rocket,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  UsersRound,
  Webhook,
  Zap,
  type LucideIcon
} from "lucide-react";

export type TabKey =
  | "onboarding"
  | "overview"
  | "integrations"
  | "shipments"
  | "customers"
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
  | "commerce-connections";

export const NAV_ITEMS: Array<{ key: TabKey; label: string; section: string; icon: LucideIcon }> = [
  { key: "onboarding", label: "Primeiros passos", section: "Começar", icon: Rocket },
  { key: "overview", label: "Operação", section: "Hoje", icon: Activity },
  { key: "shipments", label: "Pedidos e envios", section: "Hoje", icon: PackageSearch },
  { key: "customers", label: "Clientes", section: "Hoje", icon: UsersRound },
  { key: "integrations", label: "Desenvolvedores", section: "Plataforma", icon: Webhook },
  { key: "commerce-connections", label: "Loja / Commerce", section: "Plataforma", icon: Store },
  { key: "embed", label: "Embed", section: "Plataforma", icon: Code2 },
  { key: "theme", label: "Tema", section: "Plataforma", icon: Palette },
  { key: "preview", label: "Preview", section: "Plataforma", icon: Eye },
  { key: "support", label: "Suporte", section: "Atendimento", icon: MessageSquare },
  { key: "settings", label: "Checkout", section: "Atendimento", icon: Settings2 },
  { key: "rules", label: "Agente", section: "Atendimento", icon: Bot },
  { key: "negotiation", label: "Negociação", section: "Atendimento", icon: SlidersHorizontal },
  { key: "billing", label: "Faturamento", section: "Conta", icon: CreditCard },
  { key: "payment-connections", label: "Pagamentos", section: "Conta", icon: Zap },
  { key: "audit-log", label: "Auditoria", section: "Conta", icon: ShieldCheck },
];
