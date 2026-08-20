/**
 * Send store message use-case.
 *
 * Receives user message, runs LangGraph agent with tools bound,
 * returns response message + conversation blocks.
 */

import { Injectable, Inject, NotFoundException, Optional , Logger} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../domain/ports/conversation.port.js";
import { BUYER_CONVERSATION_REPOSITORY, type BuyerConversationRepository } from "../../../buyer-account/domain/ports/buyer-conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface SendStoreMessageInput {
  merchant_id: string;
  conversation_id: string;
  user_message: string;
  cart_id?: string;
  global_user_id?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface SendStoreMessageOutput {
  message: string;
  blocks: ConversationBlock[];
  cart_id?: string;
  conversation_id: string;
  suggested_next: string[];
}

@Injectable()
export class SendStoreMessageUseCase {
  private readonly logger = new Logger(SendStoreMessageUseCase.name);

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchant: MerchantRepository,
    @Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversationRepo?: BuyerConversationRepository
  ) {}

  async execute(input: SendStoreMessageInput): Promise<SendStoreMessageOutput> {
    const merchant = await this.merchant.getProfile(input.merchant_id);
    if (!merchant) throw new NotFoundException("merchant_not_found");

    const history = input.history ?? [];
    let storeSettings: Record<string, any> | undefined;
    try { storeSettings = await this.merchant.getStoreSettings(input.merchant_id) as any; } catch { /* optional */ }

    // Load agent identity from agent_rules (source of truth for agent name/persona/tone)
    let agentIdentity: { agentName?: string; persona?: string; tone?: string; greeting?: string } | undefined;
    try {
      const agentRule = await this.prisma.agentRule.findFirst({
        where: { merchantId: input.merchant_id },
        select: { identity: true },
      });
      const identity = agentRule?.identity as { agentName?: string; persona?: string; tone?: string; greeting?: string } | null;
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
            const fieldLabels: Record<string, string> = { cart_total: "carrinho", shipping_cost: "frete", product_in_cart: "produto no carrinho", category_in_cart: "categoria", coupon_applied: "cupom aplicado", buyer_type: "comprador", payment_method: "pagamento", trigger_fired: "trigger", cart_item_count: "itens no carrinho" };
            const conds = r.conditions.map(c => `${fieldLabels[c.field] || c.field} ${c.operator} ${c.value}`).join(" E ");
            const actionLabels: Record<string, string> = { offer_discount: `ofereça ${r.action.params.percent || "?"}% de desconto`, offer_free_shipping: "ofereça frete grátis", suggest_product: `sugira o produto ${r.action.params.productName || ""}`, show_message: `diga: "${r.action.params.message || ""}"`, offer_installments: `ofereça ${r.action.params.maxInstallments || "?"}x sem juros`, do_nothing: "não intervenha", offer_coupon: `ofereça o cupom ${r.action.params.code || ""}` };
            const action = actionLabels[r.action.type] || "aja conforme melhor";
            return `SE ${conds} ENTÃO ${action}`;
          });
      }
    } catch (err) {
      this.logger.warn(`Failed to load advancedRules: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (advancedRules.length > 0) {
      this.logger.debug(`[${input.merchant_id}] Loaded ${advancedRules.length} advanced rules for LLM`);
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
        let target = Math.abs(hash) % totalWeight;
        for (const variant of running.variants) {
          target -= variant.weight;
          if (target <= 0) {
            experimentSystemPrompt = variant.systemPrompt;
            break;
          }
        }
      }
    } catch {
      // Non-critical — continue without experiment prompt
    }

    const result = await this.conversation.reply({
      userMessage: input.user_message,
      cartId: input.cart_id,
      merchantId: input.merchant_id,
      sessionId: input.conversation_id,
      history,
      merchantName: merchant.name,
      storeCategory: merchant.storeCategory || "others",
      storeSettings,
      agentIdentity,
      merchantPolicy,
      advancedRules,
      experimentSystemPrompt,
    });

    // Persist conversation history (non-blocking, best-effort)
    if (this.conversationRepo && input.global_user_id) {
      try {
        const now = new Date();
        await this.conversationRepo.upsertConversation({
          globalUserId: input.global_user_id,
          sessionId: input.conversation_id,
          merchantId: input.merchant_id,
          message: {
            id: randomUUID(),
            role: "buyer",
            content: input.user_message,
            createdAt: now,
            rating: null
          }
        });
        await this.conversationRepo.upsertConversation({
          globalUserId: input.global_user_id,
          sessionId: input.conversation_id,
          merchantId: input.merchant_id,
          message: {
            id: randomUUID(),
            role: "agent",
            content: result.message,
            createdAt: new Date(),
            rating: null
          }
        });
      } catch {
        // Conversation persistence is best-effort; never block storefront flow
      }
    }

    return {
      message: result.message,
      blocks: result.blocks,
      cart_id: result.cartId,
      conversation_id: input.conversation_id,
      suggested_next: result.suggestedNext ?? []
    };
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
