import { Logger } from "@nestjs/common";
import { RecoveryAttempt } from "../../domain/entities/recovery-attempt.entity.js";
import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { AbandonmentReasonClassifier } from "../../domain/services/abandonment-reason-classifier.service.js";
import { RecoveryStrategySelector, type StrategySelectionInput } from "../../domain/services/recovery-strategy-selector.service.js";
import type { WhatsAppSenderPort } from "../../../notifications/domain/ports/whatsapp-sender.port.js";

export interface AttemptCartRecoveryInput {
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  abandonmentScore: number;
  events: string[];
  buyerHistory: StrategySelectionInput["buyerHistory"];
  merchantRules: StrategySelectionInput["merchantRules"];
  buyerPhone?: string;
  cartRef?: string | null;
  embedToken?: string | null;
  merchantCheckoutReturnUrl?: string | null;
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

    const strategy = RecoveryStrategySelector.select({
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

    if (this.whatsappSender && input.buyerPhone) {
      const link = this.linkGenerator(
        input.merchantCheckoutReturnUrl,
        input.sessionId,
        input.cartRef,
        input.embedToken,
      );
      const message = `🛒 *Seu carrinho está te esperando!*

Volte agora e finalize sua compra com desconto especial.

👉 *Acessar carrinho:* ${link}

⏰ Por tempo limitado!`;

      this.whatsappSender
        .send({ phone: input.buyerPhone, message })
        .catch((err) => {
          this.logger.error("Failed to send WhatsApp recovery message", { error: err, sessionId: input.sessionId });
        });
    }

    return { created: true, attemptId };
  }
}