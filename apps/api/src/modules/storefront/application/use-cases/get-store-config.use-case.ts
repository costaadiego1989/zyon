import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { decodePersistedTheme } from "../../../merchant/domain/services/merchant-theme.validators.js";
import { STOREFRONT_CONFIG_QUERY_PORT, type StorefrontConfigQueryPort } from "../../domain/ports/storefront-config-query.port.js";
import { BillingPlanMeteringService } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { PublicStorefrontAccessService } from "../services/public-storefront-access.service.js";

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
  showBranding?: boolean;
  /** Public UI hint only; the voice route remains the enforcement point. */
  voiceCheckoutEnabled?: boolean;
  agentMode?: "silent_until_trigger" | "proactive" | "manual_only";
  agentInitialDelaySeconds?: number;
}

@Injectable()
export class GetStoreConfigUseCase {
  constructor(
    @Inject(STOREFRONT_CONFIG_QUERY_PORT) private readonly configQuery: StorefrontConfigQueryPort,
    @Inject(BillingPlanMeteringService) private readonly billing?: BillingPlanMeteringService,
    private readonly publicStorefrontAccess?: PublicStorefrontAccessService,
  ) {}

  async execute(slug: string): Promise<StoreConfigOutput> {
    const config = await this.configQuery.findPublicConfig(slug.trim().toLowerCase());
    if (!config) throw new NotFoundException("store_not_found");

    const row = config.merchant;
    await this.publicStorefrontAccess?.assertMerchantCanServe(row.id);
    const theme = decodePersistedTheme(row.theme);
    const identity = config.agentRule?.identity as { agentName?: string; greeting?: string } | null;
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

    const voiceCheckoutEnabled = await this.isVoiceCheckoutEnabled(row.id);
    return {
      merchantId: row.id,
      name: row.name,
      logo: theme?.logoUrl ?? undefined,
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
      agentName: identity?.agentName ?? theme?.agentName,
      agentGreeting: identity?.greeting,
      quickReplies,
      stories: config.stories as any[],
      storeCategory: row.storeCategory ?? undefined,
      storeSettings: (row.storeSettings as Record<string, unknown>) ?? undefined,
      showBranding: !(config.subscriptionStatus === "active" || config.subscriptionStatus === "trialing"),
      voiceCheckoutEnabled,
      agentMode,
      agentInitialDelaySeconds: typeof checkoutSettings?.initialDelaySeconds === "number" ? checkoutSettings.initialDelaySeconds : 5,
    };
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
