import { MERCHANT_AGENT_RULE_READER, type MerchantAgentRuleReaderPort } from "../../../agent-rules/domain/ports/merchant-agent-rule-reader.port.js";
/**
 * Send store message use-case.
 *
 * Receives user message, runs LangGraph agent with tools bound,
 * returns response message + conversation blocks.
 */

import { BadRequestException, Injectable, Inject, NotFoundException, Optional, Logger, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort, type StorefrontDeferredContext } from "../../domain/ports/conversation.port.js";
import { BUYER_CONVERSATION_REPOSITORY, type BuyerConversationRepository } from "../../../buyer-account/domain/ports/buyer-conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { OneBuyClickConversationContext } from "../../domain/ports/conversation.port.js";
import { outputMatchesStorefrontScope, sendStoreMessageInputSchema, sendStoreMessageOutputSchema,
  STOREFRONT_CONTRACT_FALLBACK, STOREFRONT_CONVERSATION_CONTRACT_VERSION,
  storefrontConversationInputSchema, storefrontConversationOutputSchema } from "../../domain/contracts/storefront-conversation.schemas.js";
import { NOOP_STOREFRONT_USE_CASE_OBSERVATION, STOREFRONT_USE_CASE_OBSERVATION, type StorefrontUseCaseObservation,
  type StorefrontObservationBoundary } from "../../domain/ports/storefront-use-case-observation.port.js";
import type { StorefrontSuggestedReadActions } from "@zyon/shared-types";
import { projectStorefrontSuggestedReadActions } from "../../domain/services/storefront-suggested-read-actions.js";
import { decryptPii, isPiiEncrypted } from "../../../../shared/crypto/pii-cipher.service.js";

export interface SendStoreMessageInput {
  ui_action?: import("../../domain/types/storefront-ui-action.js").StorefrontUiAction;
  trusted_buyer_context?: { globalUserId: string; name?: string; phone?: string; email?: string };
  merchant_id: string;
  conversation_id: string;
  user_message: string;
  cart_id?: string;
  global_user_id?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  attachment_context?: string;
  device_type?: "mobile" | "tablet" | "desktop";
  one_buy_click?: OneBuyClickConversationContext;
}

export interface SendStoreMessageOutput {
  message: string;
  blocks: ConversationBlock[];
  cart_id?: string;
  conversation_id: string;
  suggested_next: string[];
  suggested_actions?: StorefrontSuggestedReadActions;
}

@Injectable()
export class SendStoreMessageUseCase {
  private readonly logger = new Logger(SendStoreMessageUseCase.name);

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchant: MerchantRepository,
    @Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MERCHANT_AGENT_RULE_READER) private readonly agentRules: MerchantAgentRuleReaderPort,
    @Optional() @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversationRepo?: BuyerConversationRepository,
    @Optional() @Inject(STOREFRONT_USE_CASE_OBSERVATION) private readonly observation: StorefrontUseCaseObservation = NOOP_STOREFRONT_USE_CASE_OBSERVATION,
  ) {}

  async execute(input: SendStoreMessageInput, deferredContext?: StorefrontDeferredContext): Promise<SendStoreMessageOutput> {
    return this.observation.turn(() => this.executeTurn(input, deferredContext));
  }

  private async executeTurn(input: SendStoreMessageInput, deferredContext?: StorefrontDeferredContext): Promise<SendStoreMessageOutput> {
    const parsedInput = await this.validate("input", () => sendStoreMessageInputSchema.safeParse(input), "invalid_input");
    if (!parsedInput.success) throw new BadRequestException("invalid_storefront_input");
    input = parsedInput.data;
    const merchant = await this.merchant.getProfile(input.merchant_id);
    if (!merchant) throw new NotFoundException("merchant_not_found");

    const history = input.history ?? [];
    let storeSettings: Record<string, any> | undefined;
    try { storeSettings = await this.merchant.getStoreSettings(input.merchant_id) as any; } catch { /* optional */ }

    // Load agent identity from agent_rules (source of truth for agent name/persona/tone/language)
    let agentIdentity: { agentName?: string; persona?: string; tone?: string; greeting?: string; language?: string } | undefined;
    try {
      const agentRule = await this.agentRules.findForMerchant(input.merchant_id);
      const identity = agentRule?.identity as { agentName?: string; persona?: string; tone?: string; greeting?: string; language?: string } | null;
      if (identity) agentIdentity = identity;
    } catch { /* optional — fallback to no identity */ }

    // Load merchant rules (discount/shipping policy limits)
    let merchantPolicy: { maxDiscountPercent?: number; allowFreeShipping?: boolean; allowShippingDiscount?: boolean; freeShippingMinCartValue?: number; maxPartialShippingDiscount?: number; offerExpirationMinutes?: number } | undefined;
    try {
      const merchantRules = await this.prisma.merchantRule.findUnique({
        where: { merchantId: input.merchant_id },
        select: {
          maxDiscountPercent: true,
          allowFreeShipping: true,
          allowShippingDiscount: true,
          freeShippingMinCartValue: true,
          maxPartialShippingDiscount: true,
          offerExpirationMinutes: true,
        },
      });
      if (merchantRules) {
        merchantPolicy = {
          maxDiscountPercent: Number(merchantRules.maxDiscountPercent),
          allowFreeShipping: merchantRules.allowFreeShipping,
          allowShippingDiscount: merchantRules.allowShippingDiscount,
          freeShippingMinCartValue: Number(merchantRules.freeShippingMinCartValue),
          maxPartialShippingDiscount: Number(merchantRules.maxPartialShippingDiscount),
          offerExpirationMinutes: merchantRules.offerExpirationMinutes,
        };
      }
    } catch { /* optional — fallback to no policy */ }

    // Load advanced rules from checkout settings
    let advancedRules: string[] = [];
    try {
      const checkoutSetting = await this.prisma.checkoutSetting.findUnique({
        where: { merchantId: input.merchant_id },
        select: { advancedRules: true },
      });
      if (checkoutSetting?.advancedRules) {
        const rules = checkoutSetting.advancedRules as Array<{ enabled: boolean; priority: number; name: string; conditions: Array<{ field: string; operator: string; value: string | number | boolean }>; action: { type: string; params: Record<string, string | number> } }>;
        advancedRules = rules
          .filter(r => r.enabled)
          .sort((a, b) => a.priority - b.priority)
          .map(r => {
            const fieldLabels: Record<string, string> = { cart_total: "valor do carrinho", shipping_cost: "frete", product_in_cart: "produto no carrinho", category_in_cart: "categoria", coupon_applied: "cupom aplicado", buyer_type: "tipo de comprador", payment_method: "forma de pagamento", trigger_fired: "gatilho", cart_item_count: "quantidade de itens" };
            const conds = r.conditions.map(c => `${fieldLabels[c.field] || c.field} ${c.operator} ${c.value}`).join(" E ");
            // FACTUAL / read-only phrasing: the deterministic cart-rules engine
            // applies these benefits automatically server-side. The LLM only
            // NARRATES what already happened — it never decides or authorizes a
            // discount (invariant: LLM never authorizes offers). So describe the
            // benefit as an automatic fact, not an instruction to "offer" it.
            const benefitLabels: Record<string, string> = {
              offer_discount: `o sistema aplica automaticamente ${r.action.params.percent || "?"}% de desconto`,
              offer_free_shipping: "o sistema aplica automaticamente frete grátis",
              suggest_product: `o produto ${r.action.params.productName || ""} pode ser sugerido`,
              show_message: `informe: "${r.action.params.message || ""}"`,
              offer_installments: `${r.action.params.maxInstallments || "?"}x sem juros ficam disponíveis`,
              do_nothing: "nenhum benefício é aplicado",
              offer_coupon: `o cupom ${r.action.params.code || ""} fica disponível`,
            };
            const benefit = benefitLabels[r.action.type] || "um benefício pode ser aplicado";
            return `QUANDO ${conds}: ${benefit} (você apenas informa o cliente; nunca prometa desconto por conta própria)`;
          });
      }
    } catch {
      this.logger.warn("storefront.context.read_failed", { source: "advanced_rules" });
    }

    if (advancedRules.length > 0) {
      this.logger.debug("storefront.context.loaded", { source: "advanced_rules" });
    }

    // Load experiment variant system prompt for this session (if A/B test running)
    let experimentSystemPrompt: string | undefined;
    try {
      const running = await this.prisma.promptExperiment.findFirst({
        where: { merchantId: input.merchant_id, status: "running" },
        include: { variants: true },
      });
      if (running && running.variants.length > 0) {
        // Use deterministic assignment based on conversation_id hash for consistency
        const hash = this.hashCode(input.conversation_id);
        const totalWeight = running.variants.reduce((sum, v) => sum + v.weight, 0);
        let target = (Math.abs(hash) % totalWeight) + 1;
        for (const variant of running.variants) {
          target -= variant.weight;
          if (target <= 0) {
            experimentSystemPrompt = variant.systemPrompt;
            this.logger.log("storefront.context.loaded", { source: "experiment_variant" });
            break;
          }
        }
      } else {
        this.logger.debug("storefront.context.absent", { source: "experiment" });
      }
    } catch {
      this.logger.warn("storefront.context.read_failed", { source: "experiment" });
    }

    let buyerContext: { globalUserId: string; name?: string; phone?: string; email?: string } | undefined;
    if (input.global_user_id) {
      try {
        const account = await this.prisma.buyerAccount.findUnique({
          where: { globalUserId: input.global_user_id },
          select: { globalUserId: true, displayName: true, phone: true, email: true },
        });
        if (account) {
          buyerContext = {
            globalUserId: account.globalUserId,
            name: account.displayName || undefined,
            email: account.email || undefined,
          };
          if (account.phone) {
            try { buyerContext.phone = isPiiEncrypted(account.phone) ? decryptPii(account.phone) : account.phone; }
            catch { this.logger.warn("storefront.context.read_failed", { source: "buyer_phone" }); }
          }
        }
      } catch {
        /* buyer identity is best-effort — never block the reply */
      }
    }

    if (input.trusted_buyer_context && input.trusted_buyer_context.globalUserId === input.global_user_id) buyerContext = input.trusted_buyer_context;
    const context = await this.validate("context", () => storefrontConversationInputSchema.safeParse({
      userMessage: input.user_message,
      uiAction: input.ui_action,
      cartId: input.cart_id,
      merchantId: input.merchant_id,
      sessionId: input.conversation_id,
      history,
      attachmentContext: input.attachment_context,
      merchantName: merchant.name,
      storeCategory: merchant.storeCategory || "others",
      storeSettings,
      agentIdentity,
      merchantPolicy,
      advancedRules,
      experimentSystemPrompt,
      buyerContext,
      oneBuyClick: input.one_buy_click,
      deviceType: input.device_type,
    }), "invalid_context");
    if (!context.success) {
      this.logger.warn("storefront.contract.invalid", { stage: "context", version: STOREFRONT_CONVERSATION_CONTRACT_VERSION,
        issueCount: context.error.issues.length });
      throw new ServiceUnavailableException("storefront_context_invalid");
    }
    const generated = deferredContext ? await this.conversation.reply(context.data, deferredContext)
      : await this.conversation.reply(context.data);
    const scope = { merchantId: input.merchant_id, cartId: input.cart_id ?? input.conversation_id };
    const result = await this.observation.operation("validation", "output", async () => {
      const parsedOutput = storefrontConversationOutputSchema.safeParse(generated);
      if (parsedOutput.success && outputMatchesStorefrontScope(parsedOutput.data, scope)) return parsedOutput.data;
      // Never log provider content/Zod values or replay a turn: commerce tools may already have run.
      this.observation.decision("output", "fallback", "invalid_output");
      this.logger.warn("storefront.contract.invalid", { stage: "output", version: STOREFRONT_CONVERSATION_CONTRACT_VERSION,
        issueCount: parsedOutput.success ? 1 : parsedOutput.error.issues.length });
      return storefrontConversationOutputSchema.parse({
        message: STOREFRONT_CONTRACT_FALLBACK, blocks: [], cartId: scope.cartId, suggestedNext: [],
      });
    });

    const suggestedActions = projectStorefrontSuggestedReadActions(result.blocks, input.merchant_id);

    // Persist conversation history sequentially and awaited, but best-effort.
    const globalUserId = input.global_user_id;
    if (this.conversationRepo && globalUserId) {
      try {
        const now = new Date();
        const repository = this.conversationRepo;
        await this.observation.operation("persistence", "buyer_message", () => repository.upsertConversation({
          globalUserId,
          sessionId: input.conversation_id,
          merchantId: input.merchant_id,
          message: {
            id: randomUUID(),
            role: "buyer",
            content: input.user_message,
            createdAt: now,
            rating: null
          }
        }));
        await this.observation.operation("persistence", "agent_message", () => repository.upsertConversation({
          globalUserId,
          sessionId: input.conversation_id,
          merchantId: input.merchant_id,
          message: {
            id: randomUUID(),
            role: "agent",
            content: result.message,
            createdAt: new Date(),
            rating: null
          }
        }));
      } catch {
        // Conversation persistence is best-effort; never block storefront flow
      }
    }

    const response = await this.validate("response", () => sendStoreMessageOutputSchema.safeParse({
      message: result.message,
      blocks: result.blocks,
      cart_id: result.cartId,
      conversation_id: input.conversation_id,
      suggested_next: result.suggestedNext ?? [],
      ...(suggestedActions ? { suggested_actions: suggestedActions } : {}),
    }), "invalid_output");
    if (!response.success) throw response.error;
    return response.data;
  }

  private validate<T extends { success: boolean }>(boundary: StorefrontObservationBoundary, parse: () => T,
    reason: "invalid_input" | "invalid_context" | "invalid_output"): Promise<T> {
    return this.observation.operation("validation", boundary, async () => {
      const parsed = parse();
      if (!parsed.success) this.observation.decision(boundary, "rejected", reason);
      return parsed;
    });
  }

  /** Deterministic hash for consistent variant assignment per conversation */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }
}
