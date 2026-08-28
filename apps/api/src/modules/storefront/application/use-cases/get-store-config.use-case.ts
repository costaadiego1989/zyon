/**
 * Get store config use-case.
 *
 * Resolves a merchant by ID or slugified name and returns
 * the public storefront configuration (theme, name, logo).
 */

import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { decodePersistedTheme } from "../../../merchant/domain/services/merchant-theme.validators.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface StoreConfigOutput {
  merchantId: string;
  name: string;
  logo?: string;
  favicon?: string;
  theme: {
    accentColor: string;
    secondaryColor?: string;
    textColor: string;
    backgroundColor: string;
    fontFamily: string;
    fontDisplay?: string;
    logoUrl?: string;
    agentAvatarUrl?: string;
    surfaceColor?: string;
    surfaceElevatedColor?: string;
    borderColor?: string;
    borderRadius?: number;
    mode?: string;
    density?: string;
    backgroundImageUrl?: string;
  };
  agentName?: string;
  agentGreeting?: string;
  quickReplies?: string[];
  stories?: any[];
  storeCategory?: string;
  storeSettings?: Record<string, unknown>;
  /** True for free-plan merchants (no active billing subscription). Shows "Powered by Zyon" badge. */
  showBranding?: boolean;
  /**
   * Storefront agent activation mode, projected from AgentRule.checkoutSettings.
   * "silent_until_trigger" (default) = stay in intro, open on a signal (idle/exit);
   * "proactive" = auto-open the chat after agentInitialDelaySeconds;
   * "manual_only" = never auto-open, buyer must open the chat.
   */
  agentMode?: "silent_until_trigger" | "proactive" | "manual_only";
  /** Delay (seconds) before the proactive mode auto-opens the chat. */
  agentInitialDelaySeconds?: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

@Injectable()
export class GetStoreConfigUseCase {
  private readonly logger = new Logger(GetStoreConfigUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  async execute(slug: string): Promise<StoreConfigOutput> {
    // Try by ID first
    let row = await this.prisma.merchant.findUnique({ where: { id: slug } });

    // If not found, try persisted slug in storeSettings, then slugified name
    if (!row) {
      const merchants = await this.prisma.merchant.findMany({
        select: { id: true, name: true, theme: true, storeSettings: true }
      });
      const match = merchants.find((m) => {
        const settings = m.storeSettings as Record<string, unknown> | null;
        const persistedSlug = settings?.slug as string | undefined;
        if (persistedSlug === slug) return true;
        return slugify(m.name) === slug;
      });
      if (match) {
        row = await this.prisma.merchant.findUnique({ where: { id: match.id } });
      }
    }

    if (!row) {
      throw new NotFoundException("store_not_found");
    }

    // Whitelabel: free-plan merchants (no active/trialing paid subscription) show
    // the "Powered by Zyon" badge in the store and checkout.
    let showBranding = true;
    try {
      const sub = await this.prisma.merchantBillingSubscription.findUnique({
        where: { merchantId: row.id },
        select: { status: true },
      });
      showBranding = !(sub && (sub.status === "active" || sub.status === "trialing"));
    } catch { /* default to showing branding (free-tier safe default) */ }

    const theme = decodePersistedTheme(row.theme);

    // Read agent identity + activation mode from agent_rules (source of truth).
    let agentName = theme?.agentName;
    let agentGreeting: string | undefined;
    let agentMode: StoreConfigOutput["agentMode"];
    let agentInitialDelaySeconds: number | undefined;
    try {
      const agentRule = await this.prisma.agentRule.findFirst({
        where: { merchantId: row.id },
        select: { identity: true, checkoutSettings: true },
      });
      const identity = agentRule?.identity as { agentName?: string; greeting?: string } | null;
      if (identity?.agentName) agentName = identity.agentName;
      if (identity?.greeting) agentGreeting = identity.greeting;

      const checkoutSettings = agentRule?.checkoutSettings as
        | { agentMode?: StoreConfigOutput["agentMode"]; initialDelaySeconds?: number }
        | null;
      const mode = checkoutSettings?.agentMode;
      if (mode === "silent_until_trigger" || mode === "proactive" || mode === "manual_only") {
        agentMode = mode;
      }
      if (typeof checkoutSettings?.initialDelaySeconds === "number") {
        agentInitialDelaySeconds = checkoutSettings.initialDelaySeconds;
      }
    } catch {}

    // Load quick replies from merchant config, or use default welcome stage
    let quickReplies: string[] | undefined;
    try {
      const settings = row.storeSettings as any;
      if (settings?.quick_replies?.stages) {
        const welcomeStage = settings.quick_replies.stages.find((s: any) => s.stage === "welcome");
        if (welcomeStage?.replies?.length) {
          quickReplies = welcomeStage.replies;
        }
      }
    } catch {}

    // Fallback to default welcome replies if not configured
    if (!quickReplies) {
      quickReplies = ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"];
    }

    // Fetch stories for this merchant
    let stories: any[] = [];
    try {
      stories = await this.prisma.storyCategory.findMany({
        where: { merchantId: row.id, isArchived: false },
        include: { stories: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      });
    } catch { /* stories table may not exist yet */ }

    return {
      merchantId: row.id,
      name: row.name,
      logo: theme?.logoUrl ?? undefined,
      favicon: theme?.logoUrl ?? undefined,
      theme: {
        accentColor: theme?.accentColor ?? "#0F766E",
        secondaryColor: theme?.secondaryColor,
        textColor: theme?.textColor ?? "#111827",
        backgroundColor: theme?.backgroundColor ?? "#F7F8FA",
        fontFamily: theme?.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif",
        fontDisplay: (theme as any)?.fontDisplay ?? undefined,
        logoUrl: theme?.logoUrl,
        agentAvatarUrl: theme?.agentAvatarUrl,
        surfaceColor: theme?.surfaceColor,
        surfaceElevatedColor: theme?.surfaceElevatedColor,
        borderColor: theme?.borderColor,
        borderRadius: (theme as any)?.borderRadius,
        mode: (theme as any)?.mode,
        density: (theme as any)?.density,
        backgroundImageUrl: (theme as any)?.backgroundImageUrl,
      },
      agentName,
      agentGreeting,
      quickReplies,
      stories,
      storeCategory: row.storeCategory ?? undefined,
      storeSettings: (row.storeSettings as Record<string, unknown>) ?? undefined,
      showBranding,
      agentMode: agentMode ?? "silent_until_trigger",
      agentInitialDelaySeconds: agentInitialDelaySeconds ?? 5,
    };
  }
}
