import { MARKETING_RELATIONSHIP, type MarketingRelationshipPort, type MarketingInboundDecision } from "../../../../shared/contracts/marketing.js";
import { Injectable, Inject, NotFoundException, Optional } from "@nestjs/common";
import { decodePersistedTheme } from "../../../merchant/domain/services/merchant-theme.validators.js";
import { STOREFRONT_CONFIG_QUERY_PORT, type StorefrontConfigQueryPort, type StorefrontConfigSnapshot } from "../../domain/ports/storefront-config-query.port.js";
import { BILLING_PLAN_ACCESS, type BillingPlanAccessPort } from "../../../payment/domain/ports/billing-plan-access.port.js";
import { checkoutTone, type CheckoutTone } from "../../../checkout/domain/services/checkout-collection-copy.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";

export interface StoreConfigOutput {
  publishedPolicies?: Record<string, string>;
  policiesAvailable?: boolean;
  budgetModeEnabled: boolean;
  cashbackEnabled: boolean;
  merchantId: string;
  name: string;
  logo?: string;
  favicon?: string;
  theme: {
    trustBadges?: string[];
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
  agentTone?: CheckoutTone;
  quickReplies?: string[];
  stories?: any[];
  storeCategory?: string;
  storeSettings?: Record<string, unknown>;
  showBranding?: boolean;
  /** Public UI hint only; the voice route remains the enforcement point. */
  voiceCheckoutEnabled?: boolean;
  marketingCrmEnabled?: boolean;
  agentMode?: "silent_until_trigger" | "proactive" | "manual_only";
  agentInitialDelaySeconds?: number;
}

@Injectable()
export class GetStoreConfigUseCase {
  constructor(
    @Inject(STOREFRONT_CONFIG_QUERY_PORT) private readonly configQuery: StorefrontConfigQueryPort,
    @Inject(BILLING_PLAN_ACCESS) private readonly billing?: BillingPlanAccessPort,
    @Optional() private readonly cashback?: CashbackService,
    @Optional() @Inject(MARKETING_RELATIONSHIP) private readonly marketing?: MarketingRelationshipPort,
  ) {}

  async execute(slug: string): Promise<StoreConfigOutput> {
    const config = await this.configQuery.findPublicConfig(slug.trim().toLowerCase());
    if (!config) throw new NotFoundException("store_not_found");
    return this.present(config);
  }

  async executeForMerchant(merchantId: string): Promise<StoreConfigOutput> {
    const config = await this.configQuery.findMerchantConfig?.(merchantId);
    if (!config || config.merchant.id !== merchantId) throw new NotFoundException("store_not_found");
    return this.present(config);
  }

  private async present(config: StorefrontConfigSnapshot): Promise<StoreConfigOutput> {
    const row = config.merchant;
    const theme = decodePersistedTheme(row.theme);
    const identity = config.agentRule?.identity as { agentName?: string; greeting?: string; tone?: string } | null;
    const checkoutSettings = config.agentRule?.checkoutSettings as
      | { agentMode?: StoreConfigOutput["agentMode"]; initialDelaySeconds?: number }
      | null;
    const mode = config.checkoutMode ?? checkoutSettings?.agentMode;
    const agentMode = mode === "silent_until_trigger" || mode === "proactive" || mode === "manual_only"
      ? mode
      : "silent_until_trigger";
    const configuredReplies = (config.quickReplies as Record<string, string[]> | null)?.welcome;
    const legacyReplies = ((row.storeSettings as any)?.quick_replies?.stages as any[] | undefined)
      ?.find((stage) => stage.stage === "welcome")?.replies;
    const quickReplies = Array.isArray(configuredReplies) && configuredReplies.length
      ? configuredReplies
      : Array.isArray(legacyReplies) && legacyReplies.length
        ? legacyReplies
        : ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"];

    const [voiceCheckoutEnabled, cashbackEnabled] = await Promise.all([
      this.isVoiceCheckoutEnabled(row.id), this.isCashbackEnabled(row.id),
    ]);
    const marketingCrmEnabled = await this.marketing?.enabled(row.id) ?? false;
    return {
      publishedPolicies: config.publishedPolicies ?? {},
      policiesAvailable: config.policiesAvailable,
      budgetModeEnabled: row.budgetModeEnabled === true,
      cashbackEnabled,
      merchantId: row.id,
      marketingCrmEnabled,
      name: row.name,
      logo: theme?.logoUrl ?? undefined,
      favicon: (theme as any)?.faviconUrl ?? theme?.logoUrl ?? undefined,
      theme: {
        trustBadges: theme?.trustBadges,
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
      agentName: identity?.agentName ?? theme?.agentName,
      agentGreeting: identity?.greeting,
      agentTone: checkoutTone(identity?.tone),
      quickReplies: cashbackEnabled ? quickReplies : quickReplies.filter(label => !/cashback/i.test(label)),
      stories: config.stories as any[],
      storeCategory: row.storeCategory ?? undefined,
      storeSettings: (row.storeSettings as Record<string, unknown>) ?? undefined,
      showBranding: !(config.subscriptionStatus === "active" || config.subscriptionStatus === "trialing"),
      voiceCheckoutEnabled,
      agentMode,
      agentInitialDelaySeconds: typeof checkoutSettings?.initialDelaySeconds === "number" ? checkoutSettings.initialDelaySeconds : 5,
    };
  }

  private async isCashbackEnabled(merchantId: string): Promise<boolean> {
    try {
      return await this.cashback?.isProgramEnabled(merchantId) === true;
    } catch {
      return false;
    }
  }

  private async isVoiceCheckoutEnabled(merchantId: string): Promise<boolean> {
    if (!this.billing) return false;
    try {
      await this.billing.assertAllowed(merchantId, { kind: "feature", key: "voiceCheckout" });
      return true;
    } catch {
      return false;
    }
  }
}
