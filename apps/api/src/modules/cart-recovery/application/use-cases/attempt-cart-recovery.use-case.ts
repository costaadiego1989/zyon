import { Logger } from "@nestjs/common";
import { RecoveryAttempt } from "../../domain/entities/recovery-attempt.entity.js";
import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { AbandonmentReasonClassifier } from "../../domain/services/abandonment-reason-classifier.service.js";
import { RecoveryStrategySelector, type StrategySelectionInput } from "../../domain/services/recovery-strategy-selector.service.js";
import type { RecoveryStrategy } from "../../domain/values/recovery-strategy.js";
import type { CartRecoveryMessageSender } from "../../domain/ports/cart-recovery-message-sender.port.js";

export interface AttemptCartRecoveryInput {
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  abandonmentScore: number;
  events: string[];
  buyerHistory: StrategySelectionInput["buyerHistory"];
  merchantRules: StrategySelectionInput["merchantRules"];
  buyerPhone?: string;
  buyerEmail?: string;
  buyerName?: string;
  merchantName?: string;
  cartRef?: string | null;
  embedToken?: string | null;
  merchantCheckoutReturnUrl?: string | null;
  forcedStrategy?: RecoveryStrategy;
}

export interface Clock {
  now(): Date;
}

export type LinkGenerator = (
  checkoutReturnUrl: string | null | undefined,
  sessionId: string,
  cartRef?: string | null,
  embedToken?: string | null,
) => string;

const MINIMUM_SCORE_THRESHOLD = 0.55;

function defaultLinkGenerator(
  checkoutReturnUrl: string | null | undefined,
  sessionId: string,
  cartRef?: string | null,
  embedToken?: string | null,
): string {
  const base = checkoutReturnUrl || process.env.PUBLIC_WIDGET_URL || "https://widget.aacp.com/checkout";
  const params = new URLSearchParams();
  if (embedToken) params.set("embedToken", embedToken);
  if (cartRef) params.set("cartRef", cartRef);
  if (sessionId) params.set("sessionId", sessionId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export class AttemptCartRecoveryUseCase {
  private readonly logger = new Logger(AttemptCartRecoveryUseCase.name);

  constructor(
    private readonly repository: RecoveryAttemptRepositoryPort,
    private readonly clock: Clock = { now: () => new Date() },
    private readonly messageSender?: CartRecoveryMessageSender,
    private readonly linkGenerator: LinkGenerator = defaultLinkGenerator,
  ) {}

  async execute(input: AttemptCartRecoveryInput): Promise<{ created: boolean; attemptId?: string }> {
    if (input.abandonmentScore < MINIMUM_SCORE_THRESHOLD) {
      return { created: false };
    }

    const exists = await this.repository.existsForSession(input.merchantId, input.sessionId);
    if (exists) {
      return { created: false };
    }

    const reason = AbandonmentReasonClassifier.classify(input.events);

    // Merchant dashboard override wins; otherwise the algorithm selects.
    const strategy = input.forcedStrategy ?? RecoveryStrategySelector.select({
      session: { abandonmentScore: input.abandonmentScore },
      buyerHistory: input.buyerHistory,
      merchantRules: input.merchantRules,
      abandonmentReason: reason,
    });

    if (strategy.type === "no_action" || strategy.type === "wait_and_retry") {
      return { created: false };
    }

    const attemptId = `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const attempt = new RecoveryAttempt({
      id: attemptId,
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      globalUserId: input.globalUserId,
      abandonmentReason: reason,
      abandonmentScore: input.abandonmentScore,
      strategy,
      channel: "none",
      sentAt: null,
      status: "pending",
      recoveredAt: null,
      recoveredOrderId: null,
      createdAt: this.clock.now(),
    });

    await this.repository.save(attempt);

    const link = this.linkGenerator(
      input.merchantCheckoutReturnUrl,
      input.sessionId,
      input.cartRef,
      input.embedToken,
    );
    const offerLine = strategyOfferLine(strategy);

    // The shared router owns connection/template validation and email fallback.
    // A contact address does not authorize a raw WhatsApp send or a second channel.
    if (this.messageSender && (input.buyerPhone || input.buyerEmail)) {
      const greeting = input.buyerName ? `Olá, ${input.buyerName}!` : "Olá!";
      const storeLabel = input.merchantName ? ` na ${input.merchantName}` : "";
      const message = `${greeting}\nSeu carrinho${storeLabel} está te esperando.\n\n${offerLine}\n\nAcessar carrinho: ${link}`;
      let result: Awaited<ReturnType<CartRecoveryMessageSender["execute"]>>;
      try {
        result = await this.messageSender.execute({
          merchantId: input.merchantId,
          type: "cart_recovery",
          toPhone: input.buyerPhone,
          fallbackEmail: input.buyerEmail,
          variables: {
            buyerName: input.buyerName,
            storeName: input.merchantName,
            coupon: strategy.type === "offer_coupon" ? strategy.coupon_code : undefined,
            discountPercent: strategy.type === "offer_coupon" ? strategy.coupon_percent
              : strategy.type === "escalate_discount" ? strategy.value_percent : undefined,
            link,
          },
          freeformText: message,
          emailSubject: `${input.merchantName ? `[${input.merchantName}] ` : ""}Seu carrinho está te esperando`,
        });
      } catch (error) {
        // A thrown transport error may follow provider acceptance. Hold the
        // attempt for reconciliation; never retry or choose another channel here.
        await this.repository.save(attempt.markUnknown());
        this.logger.error("recovery: delivery outcome unknown", { sessionId: input.sessionId, error });
        return { created: true, attemptId };
      }

      const channel = result.channel === "whatsapp_template" || result.channel === "email"
        ? result.channel : undefined;
      if (result.status === "sent" && channel && result.messageId?.trim()) {
        await this.repository.save(attempt.markSent(this.clock.now(), channel));
      } else if (result.status === "uncertain" || result.status === "sent") {
        await this.repository.save(attempt.markUnknown(channel));
      } else if (result.status === "failed") {
        await this.repository.save(attempt.markFailed(channel));
      }
      // Skips stay pending. No immediate retry, legacy sender or parallel email.
    }

    return { created: true, attemptId };
  }
}

/** Human-readable offer line per strategy, used in WhatsApp + email copy. */
function strategyOfferLine(strategy: RecoveryStrategy): string {
  switch (strategy.type) {
    case "offer_free_shipping":
      return "Volte agora e ganhe *frete grátis* na sua compra.";
    case "offer_coupon":
      return strategy.coupon_code
        ? `Use o cupom *${strategy.coupon_code}* e finalize com desconto.`
        : "Volte agora e finalize com um desconto especial.";
    case "personalized_cross_sell":
      return "Separamos itens que combinam com o que você escolheu.";
    case "escalate_discount":
      return `Volte agora e ganhe *${strategy.value_percent}% OFF*.`;
    case "advanced_rule":
      return strategy.description || "Temos uma oferta especial pra você.";
    default:
      return "Volte agora e finalize sua compra.";
  }
}
