import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { CheckoutSettingsContext, ProgressiveOfferResponse, TrackEventRequest, TrackEventResponse } from "@zyon/shared-types";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import {
  CHECKOUT_INTERVENTION_LEDGER,
  type CheckoutInterventionLedgerPort
} from "../../domain/ports/checkout-intervention-ledger.port.js";
import { decideInterventions } from "../../domain/services/intervention-policy.service.js";
import {
  resolveProgressiveDiscountStage,
  selectProgressiveDiscountPercent
} from "../../domain/services/progressive-discount-policy.service.js";
import type { CheckoutSession } from "@zyon/shared-types";

@Injectable()
export class TrackCheckoutEventUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRepository?: MerchantRulesRepository,
    @Optional() @Inject(CHECKOUT_INTERVENTION_LEDGER)
    private readonly interventionLedger?: CheckoutInterventionLedgerPort
  ) {}

  async execute(input: TrackEventRequest): Promise<TrackEventResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) {
      throw new NotFoundException("checkout_session_not_found");
    }
    await this.sessions.recordEvent(input.merchant_id, input.session_id, input.event);
    // Fetch the updated session once after recordEvent (which mutates abandonmentScore/triggerAgent).
    // Reuse that single fetch throughout this handler — avoids redundant round-trips on the hot path.
    const afterRecord = await this.sessions.getSession(input.merchant_id, input.session_id) ?? session;
    // Fetch settings once and reuse in both applyOperationalSettings and applyInterventionLedgerGate.
    const settingsCtx = await this.checkoutSettings?.getContext(input.merchant_id);
    const updated = await this.applyOperationalSettings(
      input.merchant_id,
      input.session_id,
      input.event,
      afterRecord,
      settingsCtx
    );
    const finalSession = await this.applyInterventionLedgerGate(
      input.merchant_id,
      input.session_id,
      updated,
      settingsCtx ?? undefined
    );
    await this.outbox.appendOutbox(
      createCheckoutEventEnvelope({
        eventType: "checkout.event.tracked",
        merchantId: input.merchant_id,
        payload: {
          session_id: input.session_id,
          event_name: input.event,
          metadata: input.metadata ?? {},
          previous_abandonment_score: session.abandonmentScore,
          next_abandonment_score: finalSession.abandonmentScore,
          trigger_agent: finalSession.triggerAgent
        },
        causationId: input.event
      })
    );
    if (finalSession.abandonmentScore !== session.abandonmentScore) {
      await this.outbox.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "checkout.abandonment.scored",
          merchantId: input.merchant_id,
          payload: {
            session_id: input.session_id,
            previous_score: session.abandonmentScore,
            next_score: finalSession.abandonmentScore,
            trigger_agent: finalSession.triggerAgent,
            reason: input.event
          },
          causationId: input.event
        })
      );
    }
    const progressiveOffer = await this.authorizeProgressiveOffer(input.event, finalSession, settingsCtx ?? undefined);
    if (input.event === "checkout_abandoned") {
      await this.outbox.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "checkout.abandoned",
          merchantId: input.merchant_id,
          payload: {
            session_id: input.session_id,
            abandonment_score: finalSession.abandonmentScore
          },
          causationId: input.event
        })
      );
      const abandonmentOffer = progressiveOffer ?? await this.authorizeFallbackAbandonmentOffer(finalSession);
      if (finalSession.customer?.phone && abandonmentOffer) {
        await this.outbox.appendOutbox(
          createCheckoutEventEnvelope({
            eventType: "whatsapp.message.requested",
            merchantId: input.merchant_id,
            payload: {
              session_id: input.session_id,
              phone: finalSession.customer.phone,
              template: "checkout_abandonment_discount",
              discount_percent: abandonmentOffer.approved_percent,
              message: `Voce deixou seu pedido no checkout. Mantive ${abandonmentOffer.approved_percent}% de desconto para voce fechar a compra agora.`
            },
            causationId: input.event
          })
        );
      }
    }
    return {
      received: true,
      abandonment_score: finalSession.abandonmentScore,
      trigger_agent: finalSession.triggerAgent,
      progressive_offer: progressiveOffer
    };
  }

  private async authorizeProgressiveOffer(
    eventName: TrackEventRequest["event"],
    session: CheckoutSession,
    settingsCtx: CheckoutSettingsContext | undefined
  ): Promise<ProgressiveOfferResponse | undefined> {
    if (!this.merchantRepository) return undefined;
    const stage = resolveProgressiveDiscountStage(eventName);
    const requested = selectProgressiveDiscountPercent(settingsCtx?.checkout_settings.progressive_discount, stage);
    if (!stage || requested <= 0) return undefined;
    const rules = await this.merchantRepository.getRules(session.merchantId);
    if (!rules || rules.couponBoxEnabled === false) return undefined;
    const evaluation = evaluateDiscountOffer(session.cart, rules, requested);
    if (!evaluation.approved || evaluation.value <= 0) return undefined;
    // Progressive discount is a TOTAL target, not additive.
    // If buyer already has a discount >= this stage's approved value, skip.
    const currentDiscountPercent = session.cart.total > 0
      ? ((session.cart.currentDiscount ?? 0) / session.cart.total) * 100
      : 0;
    if (evaluation.value <= currentDiscountPercent) return undefined;
    return {
      stage,
      requested_percent: requested,
      approved_percent: evaluation.value,
      reason: evaluation.reason
    };
  }

  private async authorizeFallbackAbandonmentOffer(session: CheckoutSession): Promise<ProgressiveOfferResponse | undefined> {
    if (!this.merchantRepository) return undefined;
    const rules = await this.merchantRepository.getRules(session.merchantId);
    if (!rules || rules.couponBoxEnabled === false) return undefined;
    const evaluation = evaluateDiscountOffer(session.cart, rules, rules.maxDiscountPercent);
    if (!evaluation.approved || evaluation.value <= 0) return undefined;
    return {
      stage: "abandoned_cart",
      requested_percent: rules.maxDiscountPercent,
      approved_percent: evaluation.value,
      reason: evaluation.reason
    };
  }

  private async applyInterventionLedgerGate(
    merchantId: string,
    sessionId: string,
    session: CheckoutSession,
    settingsCtx: CheckoutSettingsContext | undefined
  ): Promise<CheckoutSession> {
    if (!this.interventionLedger || !settingsCtx || !session.triggerAgent) {
      return session;
    }
    const nowUnix = Math.floor(Date.now() / 1000);
    const count = await this.interventionLedger.countForSession(merchantId, sessionId);
    const last = await this.interventionLedger.lastOccurredAt(merchantId, sessionId);
    const pol = decideInterventions({
      proactiveEnabled: settingsCtx.checkout_settings.mode !== "manual_only",
      cooldownSeconds: settingsCtx.checkout_settings.cooldown_seconds,
      maxInterventionsPerSession: settingsCtx.checkout_settings.max_interventions_per_session,
      nowUnix,
      triggerAgentFromScore: session.triggerAgent,
      interventionCount: count,
      lastInterventionUnix: last
    });
    if (!pol.triggerAgent) {
      const next = { ...session, triggerAgent: false, updatedAt: new Date().toISOString() };
      await this.sessions.saveSession(next);
      return next;
    }
    await this.interventionLedger.record({
      merchantId,
      sessionId,
      occurredAtUnix: nowUnix,
      reason: "agent_trigger_allowed"
    });
    return session;
  }

  private async applyOperationalSettings(
    merchantId: string,
    sessionId: string,
    eventName: TrackEventRequest["event"],
    session: CheckoutSession,
    settingsCtx?: CheckoutSettingsContext | null
  ) {
    const settings = settingsCtx ?? await this.checkoutSettings?.getContext(merchantId);
    if (!settings) return session;
    const configured = settings.checkout_settings;
    const eventCanTrigger = configured.enabled_triggers.some((trigger) => trigger === eventName);
    const shouldTrigger =
      configured.mode !== "manual_only" &&
      eventCanTrigger &&
      session.abandonmentScore >= configured.minimum_abandonment_score &&
      session.triggerAgent;
    const finalTrigger = shouldTrigger;
    if (session.triggerAgent === finalTrigger) return session;
    const next = { ...session, triggerAgent: finalTrigger, updatedAt: new Date().toISOString() };
    await this.sessions.saveSession(next);
    return next;
  }
}
