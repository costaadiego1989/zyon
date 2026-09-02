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
    mutedTextColor?: string;
    backgroundColor: string;
    fontFamily: string;
    fontDisplay?: string;
    logoUrl?: string;
    agentAvatarUrl?: string;
    surfaceColor?: string;
    surfaceElevatedColor?: string;
    borderColor?: string;
    successColor?: string;
    warningColor?: string;
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
    // Custom domain resolution — the storefront middleware rewrites a request to
    // a custom host (e.g. loja.cliente.com.br) to /store/{host}, so a slug that
    // looks like a hostname is resolved against verified MerchantDomain records
    // before the id/slug/name lookups. Only VERIFIED domains resolve; an
    // unverified (DNS not yet pointed) domain must not serve a store.
    let row: Awaited<ReturnType<typeof this.prisma.merchant.findUnique>> = null;
    if (slug.includes(".")) {
      const domainRecord = await this.prisma.merchantDomain.findUnique({
        where: { domain: slug.toLowerCase() },
        select: { merchantId: true, verified: true },
      });
      if (domainRecord?.verified) {
        row = await this.prisma.merchant.findUnique({ where: { id: domainRecord.merchantId } });
      }
    }

    // Try by ID
    if (!row) {
      row = await this.prisma.merchant.findUnique({ where: { id: slug } });
    }

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

    // Load quick replies from merchant_rules (source of truth — the dashboard agent
    // config saves them there as a stage→replies map, e.g. { welcome: [...] }).
    // Legacy fallback also reads the older storeSettings.quick_replies.stages shape.
    let quickReplies: string[] | undefined;
    try {
      const rules = await this.prisma.merchantRule.findUnique({
        where: { merchantId: row.id },
        select: { quickReplies: true },
      });
      const qr = rules?.quickReplies as Record<string, string[]> | null;
      if (qr && Array.isArray(qr.welcome) && qr.welcome.length) {
        quickReplies = qr.welcome;
      }
    } catch {}

    // Legacy shape fallback: storeSettings.quick_replies.stages[]
    if (!quickReplies) {
      try {
        const settings = row.storeSettings as any;
        const welcomeStage = settings?.quick_replies?.stages?.find((s: any) => s.stage === "welcome");
        if (welcomeStage?.replies?.length) quickReplies = welcomeStage.replies;
      } catch {}
    }

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
      // Prefer the dedicated favicon; fall back to the logo when none was set.
      favicon: (theme as any)?.faviconUrl ?? theme?.logoUrl ?? undefined,
      theme: {
        accentColor: theme?.accentColor ?? "#0F766E",
        secondaryColor: theme?.secondaryColor,
        textColor: theme?.textColor ?? "#111827",
        mutedTextColor: (theme as any)?.mutedTextColor,
        backgroundColor: theme?.backgroundColor ?? "#F7F8FA",
        fontFamily: theme?.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif",
        fontDisplay: (theme as any)?.fontDisplay ?? undefined,
        logoUrl: theme?.logoUrl,
        agentAvatarUrl: theme?.agentAvatarUrl,
        surfaceColor: theme?.surfaceColor,
        surfaceElevatedColor: theme?.surfaceElevatedColor,
        borderColor: theme?.borderColor,
        successColor: (theme as any)?.successColor,
        warningColor: (theme as any)?.warningColor,
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
