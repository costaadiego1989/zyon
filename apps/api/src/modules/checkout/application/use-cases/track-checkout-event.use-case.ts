import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { CheckoutSettingsContext, TrackEventRequest, TrackEventResponse } from "@aacp/shared-types";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import {
  CHECKOUT_INTERVENTION_LEDGER,
  type CheckoutInterventionLedgerPort
} from "../../domain/ports/checkout-intervention-ledger.port.js";
import { decideInterventions } from "../../domain/services/intervention-policy.service.js";
import { withCheckoutTransaction } from "./checkout-transaction.js";

@Injectable()
export class TrackCheckoutEventUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(CHECKOUT_INTERVENTION_LEDGER)
    private readonly interventionLedger?: CheckoutInterventionLedgerPort
  ) {}

  async execute(input: TrackEventRequest): Promise<TrackEventResponse> {
    return withCheckoutTransaction(this.repository, async (repository) => {
    const session = await repository.getSession(input.merchant_id, input.session_id);
    if (!session) {
      throw new NotFoundException("checkout_session_not_found");
    }
    await repository.recordEvent(input.merchant_id, input.session_id, input.event);
    const updated = await this.applyOperationalSettings(
      repository,
      input.merchant_id,
      input.session_id,
      input.event,
      (await repository.getSession(input.merchant_id, input.session_id))!
    );
    const settingsCtx = await this.checkoutSettings?.getContext(input.merchant_id);
    const finalSession = await this.applyInterventionLedgerGate(
      repository,
      input.merchant_id,
      input.session_id,
      updated,
      settingsCtx ?? undefined
    );
    await repository.appendOutbox(
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
      await repository.appendOutbox(
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
    return {
      received: true,
      abandonment_score: finalSession.abandonmentScore,
      trigger_agent: finalSession.triggerAgent
    };
    });
  }

  private async applyInterventionLedgerGate(
    repository: CheckoutRepository,
    merchantId: string,
    sessionId: string,
    session: NonNullable<Awaited<ReturnType<CheckoutRepository["getSession"]>>>,
    settingsCtx: CheckoutSettingsContext | undefined
  ): Promise<NonNullable<Awaited<ReturnType<CheckoutRepository["getSession"]>>>> {
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
      await repository.saveSession(next);
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
    repository: CheckoutRepository,
    merchantId: string,
    sessionId: string,
    eventName: TrackEventRequest["event"],
    session: Awaited<ReturnType<CheckoutRepository["getSession"]>>
  ) {
    if (!session) return session!;
    const settings = await this.checkoutSettings?.getContext(merchantId);
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
    await repository.saveSession(next);
    return next;
  }
}
