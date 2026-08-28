import { Logger } from "@nestjs/common";
import { RecoveryAttempt } from "../../domain/entities/recovery-attempt.entity.js";
import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { AbandonmentReasonClassifier } from "../../domain/services/abandonment-reason-classifier.service.js";
import { RecoveryStrategySelector, type StrategySelectionInput } from "../../domain/services/recovery-strategy-selector.service.js";
import type { RecoveryStrategy } from "../../domain/values/recovery-strategy.js";
import type { WhatsAppSenderPort } from "../../../notifications/domain/ports/whatsapp-sender.port.js";
import type { EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";

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
  /** Merchant dashboard override — when set, use this instead of the algorithm. */
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
    private readonly whatsappSender?: WhatsAppSenderPort,
    private readonly linkGenerator: LinkGenerator = defaultLinkGenerator,
    private readonly emailSender?: EmailSenderPort,
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

    if (strategy.type === "no_action") {
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
      channel: "in_session",
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

    // Send on BOTH channels (WhatsApp via Bubble + email via Resend), always,
    // whenever the buyer contact is available. Failures are non-blocking.
    let anySent = false;

    if (this.whatsappSender && input.buyerPhone) {
      const message = `🛒 *Seu carrinho está te esperando!*

${offerLine}

👉 *Acessar carrinho:* ${link}

⏰ Por tempo limitado!`;
      anySent = true;
      this.whatsappSender
        .send({ phone: input.buyerPhone, message })
        .catch((err) => {
          this.logger.error("Failed to send WhatsApp recovery message", { error: err, sessionId: input.sessionId });
        });
    }

    if (this.emailSender && input.buyerEmail) {
      const greeting = input.buyerName ? `Olá, ${input.buyerName}!` : "Olá!";
      const subject = `${input.merchantName ? `[${input.merchantName}] ` : ""}Seu carrinho está te esperando 🛒`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px">${greeting}</h2>
  <p style="font-size:15px;line-height:1.5;color:#333">Você deixou itens no carrinho. ${offerLine}</p>
  <p style="margin:20px 0"><a href="${link}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#0f766e;color:#fff;text-decoration:none;font-weight:600">Finalizar minha compra</a></p>
  <p style="font-size:12px;color:#888">⏰ Oferta por tempo limitado.</p>
</div>`;
      anySent = true;
      this.emailSender
        .send({ to: input.buyerEmail, subject, html })
        .catch((err) => {
          this.logger.error("Failed to send email recovery message", { error: err, sessionId: input.sessionId });
        });
    }

    // Mark as sent when at least one channel was dispatched.
    if (anySent) {
      const sent = attempt.markSent(this.clock.now());
      await this.repository.save(sent);
    } else {
      this.logger.warn("recovery: no buyer contact (phone/email) — attempt stays in_session pending", { sessionId: input.sessionId });
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