import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  Code2,
  CreditCard,
  Crown,
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
  Network,
  type LucideIcon
} from "lucide-react";

export type MerchantPlan = "STORE_ONLY" | "BOTH" | "API";

export type TabKey =
  | "onboarding"
  | "overview"
  | "integrations"
  | "integrations-api"
  | "crm-integrations"
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
  | "chargebacks"
  | "delivery";

/**
 * Section metadata drives the collapsible sidebar.
 * `order` controls vertical position. `defaultOpen: false` collapses
 * advanced/rarely-used sections so the sidebar stays scannable.
 */
export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  order: number;
  defaultOpen: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  { id: "daily", label: "Diário", icon: Activity, order: 1, defaultOpen: true },
  { id: "sales", label: "Vendas", icon: TrendingUp, order: 2, defaultOpen: true },
  { id: "catalog", label: "Catálogo", icon: ShoppingBag, order: 3, defaultOpen: true },
  { id: "channels", label: "Canais", icon: Network, order: 4, defaultOpen: false },
  { id: "integrations", label: "Integrações", icon: Plug, order: 5, defaultOpen: false },
  { id: "intelligence", label: "Inteligência IA", icon: Brain, order: 6, defaultOpen: false },
  { id: "settings", label: "Configurações", icon: Settings, order: 7, defaultOpen: false },
];

export interface NavItem {
  key: TabKey;
  label: string;
  section: string;
  icon: LucideIcon;
  requiredPlan?: MerchantPlan | MerchantPlan[];
  /** Optional badge key — resolved at runtime (pending orders, unread messages, etc). */
  badge?: "orders" | "messages" | "cart-recovery" | "returns";
  /** Search keywords for cmd+K filtering (Portuguese + English + old names). */
  keywords?: string[];
}

const STORE = ["STORE_ONLY", "BOTH"] as MerchantPlan[];

export const NAV_ITEMS: NavItem[] = [
  // ─── Início (não numa seção — sempre no topo quando presente) ───
  { key: "onboarding", label: "Primeiros passos", section: "daily", icon: Rocket, keywords: ["onboarding", "começar", "setup", "início"] },

  // ─── DIÁRIO ─── operações que o lojista abre todo dia
  { key: "overview", label: "Visão Geral", section: "daily", icon: Activity, keywords: ["dashboard", "home", "resumo", "métricas"] },
  { key: "shipments", label: "Pedidos & Envios", section: "daily", icon: PackageSearch, requiredPlan: STORE, badge: "orders", keywords: ["pedidos", "orders", "envios", "shipments", "entregas"] },
  { key: "customers", label: "Clientes", section: "daily", icon: UsersRound, requiredPlan: STORE, keywords: ["clientes", "customers", "compradores"] },
  { key: "cart-recovery", label: "Recuperação de Carrinho", section: "daily", icon: ShoppingCart, requiredPlan: STORE, badge: "cart-recovery", keywords: ["carrinho", "cart", "recovery", "abandonado", "recuperação"] },
  { key: "support", label: "Atendimento", section: "daily", icon: MessageSquare, badge: "messages", keywords: ["suporte", "support", "atendimento", "chamados", "tickets", "mensagens"] },

  // ─── VENDAS ─── otimização de conversão
  { key: "funnel", label: "Funil de Conversão", section: "sales", icon: BarChart3, requiredPlan: STORE, keywords: ["funil", "funnel", "conversão", "conversion"] },
  { key: "settings", label: "Checkout", section: "sales", icon: Settings2, requiredPlan: STORE, keywords: ["checkout", "configurações checkout", "widget config"] },
  { key: "preview", label: "Preview do Checkout", section: "sales", icon: Eye, requiredPlan: STORE, keywords: ["preview", "prévia", "testar checkout"] },
  { key: "coupons", label: "Cupons", section: "sales", icon: Tag, requiredPlan: STORE, keywords: ["cupons", "coupons", "desconto", "discount", "promoção"] },
  { key: "cross-sell", label: "Cross Sell", section: "sales", icon: Sparkles, requiredPlan: STORE, keywords: ["cross-sell", "cross sell", "venda cruzada", "sugestões"] },
  { key: "experiments", label: "Testes A/B", section: "sales", icon: Zap, requiredPlan: STORE, keywords: ["testes", "experimentos", "a/b", "experiments", "ab test"] },
  { key: "negotiation-policy", label: "Negociação", section: "sales", icon: Handshake, requiredPlan: STORE, keywords: ["negociação", "negotiation", "barganha", "oferta"] },
  { key: "checkout-programavel", label: "Automações", section: "sales", icon: Code2, requiredPlan: STORE, keywords: ["automações", "programável", "regras", "rules", "automation"] },

  // ─── CATÁLOGO ─── gestão de produtos
  { key: "catalog", label: "Produtos", section: "catalog", icon: ShoppingBag, requiredPlan: STORE, keywords: ["produtos", "products", "catálogo", "catalog", "itens"] },
  { key: "categories", label: "Categorias", section: "catalog", icon: FolderTree, requiredPlan: STORE, keywords: ["categorias", "categories", "coleções"] },
  { key: "inventory", label: "Estoque", section: "catalog", icon: Package, requiredPlan: STORE, keywords: ["estoque", "inventory", "inventário", "quantidade"] },
  { key: "delivery", label: "Frete & Entregas", section: "catalog", icon: PackageSearch, requiredPlan: STORE, keywords: ["frete", "entrega", "delivery", "shipping", "melhor envio", "etiqueta", "rastreio"] },
  { key: "stories", label: "Stories", section: "catalog", icon: CircleDashed, requiredPlan: STORE, keywords: ["stories", "histórias", "destaques"] },

  // ─── CANAIS ─── multi-channel + aparência
  { key: "agent-config", label: "Agente IA", section: "channels", icon: Bot, requiredPlan: STORE, keywords: ["agente", "agent", "ia", "ai", "assistente", "bot"] },
  { key: "theme", label: "Tema & Aparência", section: "channels", icon: Palette, requiredPlan: STORE, keywords: ["tema", "theme", "aparência", "cores", "visual", "branding"] },
  { key: "whatsapp-seller", label: "WhatsApp", section: "channels", icon: Smartphone, keywords: ["whatsapp", "zap", "wpp", "vendedor"] },
  { key: "marketplace", label: "Marketplace", section: "channels", icon: ShoppingBag, keywords: ["marketplace", "mercado", "conexões"] },
  { key: "custom-domain", label: "Domínio", section: "channels", icon: Globe, requiredPlan: STORE, keywords: ["domínio", "domain", "dns", "url", "site"] },

  // ─── INTEGRAÇÕES ─── conexões técnicas
  { key: "payment-connections", label: "Pagamentos", section: "integrations", icon: CreditCard, keywords: ["pagamentos", "payments", "asaas", "stripe", "mercado pago", "gateway"] },
  { key: "integrations", label: "E-commerce", section: "integrations", icon: Plug, keywords: ["shopify", "woocommerce", "nuvemshop", "vtex", "e-commerce", "loja"] },
  { key: "crm-integrations", label: "CRM & Marketing", section: "integrations", icon: Plug, keywords: ["crm", "marketing", "hubspot", "pipedrive", "rd station"] },
  { key: "integrations-api", label: "API & Webhooks", section: "integrations", icon: Webhook, keywords: ["api", "webhooks", "chaves", "keys", "desenvolvedor", "integração"] },

  // ─── INTELIGÊNCIA IA ─── features avançadas/analytics
  { key: "revenue-manager", label: "Otimizador IA", section: "intelligence", icon: Brain, requiredPlan: STORE, keywords: ["otimizador", "revenue manager", "ia", "hipóteses", "otimização"] },
  { key: "revenue-lift", label: "Impacto no Revenue", section: "intelligence", icon: TrendingUp, requiredPlan: STORE, keywords: ["revenue lift", "impacto", "incremento", "holdout", "atribuição"] },
  { key: "intent-memory", label: "Memória de Intenção", section: "intelligence", icon: Brain, requiredPlan: STORE, keywords: ["intent", "intenção", "memória", "memory", "perfil"] },
  { key: "m2m-agents", label: "Agentes M2M", section: "intelligence", icon: Bot, keywords: ["m2m", "agentes", "machine to machine", "protocolo"] },

  // ─── CONFIGURAÇÕES ─── raramente mexido
  { key: "account-settings", label: "Conta", section: "settings", icon: Settings, keywords: ["conta", "account", "perfil", "senha", "email"] },
  { key: "team", label: "Equipe", section: "settings", icon: Users, keywords: ["equipe", "team", "membros", "usuários", "convidar"] },
  { key: "billing-plans", label: "Planos & Faturamento", section: "settings", icon: Crown, keywords: ["planos", "plans", "faturamento", "billing", "assinatura", "upgrade"] },
  { key: "billing", label: "Histórico de Cobrança", section: "settings", icon: CreditCard, keywords: ["cobrança", "faturas", "invoices", "histórico", "pagamento"] },
  { key: "chargebacks", label: "Chargebacks", section: "settings", icon: AlertTriangle, keywords: ["chargebacks", "disputas", "contestações", "estornos"] },
  { key: "audit-log", label: "Auditoria", section: "settings", icon: ShieldCheck, keywords: ["auditoria", "audit", "log", "histórico", "segurança"] },
  { key: "store-settings", label: "Config. da Loja", section: "settings", icon: Save, requiredPlan: STORE, keywords: ["configurações loja", "store settings", "políticas", "seo"] },
];

/**
 * Resolve which sections are visible for a plan (a section shows only if it
 * has at least one item the plan can see).
 */
export function visibleItemsForPlan(items: NavItem[], plan: MerchantPlan): NavItem[] {
  return items.filter((item) => {
    if (!item.requiredPlan) return true;
    const allowed = Array.isArray(item.requiredPlan) ? item.requiredPlan : [item.requiredPlan];
    return allowed.includes(plan);
  });
}
