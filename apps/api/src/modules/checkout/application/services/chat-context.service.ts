import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type {
  CheckoutSession,
  MerchantRules,
  SuggestedProduct,
  AgentContext as SharedAgentContext
} from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../../merchant/domain/ports/merchant-repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import { PRODUCT_SEARCH_PORT, type ProductSearchPort } from "../../domain/ports/product-search.port.js";
import { TenantBoundaryGuard } from "../../domain/services/tenant-boundary.guard.js";
import { InterventionRuleTextBuilder } from "./intervention-rule-text.builder.js";
import { BuyerContextService } from "./buyer-context.service.js";

export interface ChatContextLoaded {
  session: CheckoutSession;
  merchant: { id: string; name?: string } | undefined;
  rules: MerchantRules;
  agentContext: SharedAgentContext | undefined;
  preSearchedProducts: SuggestedProduct[];
  merchantRules: string[] | undefined;
  paymentJustFailed: boolean;
}

/**
 * Loads session, merchant config, agent context, and advisory rules for LLM routing.
 * Handles all non-critical port lookups gracefully.
 */
@Injectable()
export class ChatContextService {
  private readonly logger = new Logger(ChatContextService.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly interventionBuilder: InterventionRuleTextBuilder,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(PRODUCT_SEARCH_PORT) private readonly productSearch?: ProductSearchPort,
    @Optional() private readonly buyerContext?: BuyerContextService
  ) {}

  async loadContext(
    merchantId: string,
    sessionId: string,
    userId: string | undefined,
    agentId: string | undefined,
    userMessage: string
  ): Promise<ChatContextLoaded> {
    const session = await this.sessions.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const rules = await this.merchantRepo?.getRules(merchantId) ?? DEFAULT_MERCHANT_RULES;
    const merchant = await this.merchantRepo?.getProfile(merchantId);

    TenantBoundaryGuard.assert.merchantIdMatches(
      session.merchantId,
      merchantId,
      "chat context lookup"
    );

    const agentContext = await this.agentContext?.get({
      merchantId,
      userId,
      agentId,
      globalUserId: session.globalUserId
    });

    // F1-T03: Attach buyer intent (LGPD-consent-gated inside BuyerContextService)
    // onto the session so CheckoutOfferService can modulate the discount cap for
    // treatment cohort. No consent / no intent → nothing attached (fallback path).
    if (this.buyerContext && session.globalUserId) {
      try {
        const { buyerIntent } = await this.buyerContext.load(merchantId, session.globalUserId);
        if (buyerIntent) {
          (session as any).buyerIntent = buyerIntent;
        }
      } catch (intentErr) {
        this.logger.warn("chat.intent.load.failed", {
          merchantId,
          error: intentErr instanceof Error ? intentErr.message : String(intentErr)
        });
      }
    }

    let preSearchedProducts: SuggestedProduct[] = [];
    if (this.productSearch && this.isCartEmpty(session.cart)) {
      const searchQuery = this.extractProductSearchIntent(userMessage);
      if (searchQuery) {
        try {
          preSearchedProducts = await this.productSearch.execute(merchantId, searchQuery, 6);
        } catch {
          // catalog search non-critical
        }
      }
    }

    let merchantRules: string[] | undefined;
    const paymentJustFailed = this.detectPaymentFailure(session);

    try {
      const interventionConfig = await this.checkoutSettings?.getInterventionConfig(merchantId);
      if (interventionConfig) {
        merchantRules = this.interventionBuilder.build(interventionConfig, paymentJustFailed);
      }
    } catch (rulesErr) {
      this.logger.error("rules.load.failed", { error: rulesErr instanceof Error ? rulesErr.message : String(rulesErr) });
    }

    return {
      session,
      merchant,
      rules,
      agentContext,
      preSearchedProducts,
      merchantRules,
      paymentJustFailed
    };
  }

  private isCartEmpty(cart: { items?: unknown[] }): boolean {
    return !cart?.items?.length;
  }

  private extractProductSearchIntent(message: string): string | null {
    const patterns = [
      /(?:procur|busc|quer|quero|preciso|tem|vend|mostr)\w*\s+(.{3,60})/i,
      /(?:looking for|show me|i want|do you have)\s+(.{3,60})/i,
    ];
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match?.[1]) return match[1].replace(/[?.!,;]+$/, "").trim();
    }
    return null;
  }

  private detectPaymentFailure(session: CheckoutSession): boolean {
    const lastAgentTurn = [...session.chatHistory]
      .reverse()
      .find((t) => t.role === "agent")?.text;
    return /pagamento (falhou|recusad|não foi|nao foi|nao aprovad|não aprovad)/i.test(lastAgentTurn ?? "");
  }
}
