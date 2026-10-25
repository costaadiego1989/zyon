import { Inject, Injectable, Logger } from "@nestjs/common";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";

export type ProtocolEventType =
  | "protocol.session_started"
  | "protocol.discovered"
  | "protocol.negotiated"
  | "protocol.quoted"
  | "protocol.confirmed"
  | "protocol.payment_pending"
  | "protocol.payment_confirmed"
  | "protocol.payment_failed"
  | "protocol.session_expired";

/**
 * Maps state transitions to event types
 */
const STATE_TO_EVENT: Record<string, ProtocolEventType> = {
  idle: "protocol.session_started",
  discovered: "protocol.discovered",
  negotiated: "protocol.negotiated",
  quoted: "protocol.quoted",
  confirmed: "protocol.confirmed",
  payment_pending: "protocol.payment_pending",
  paid: "protocol.payment_confirmed",
  tracking: "protocol.payment_confirmed",
  expired: "protocol.session_expired",
};

export interface ProtocolWebhookPayload {
  event_type: string;
  session_id: string;
  previous_state: string;
  new_state: string;
  payload: Record<string, unknown>;
  timestamp: string;
  callback_url?: string;
}

/**
 * Publishes webhook events via the OutboxMessage pattern.
 * The outbox dispatcher is responsible for actual HTTP delivery to the agent's callback_url.
 */
@Injectable()
export class ProtocolWebhookPublisher {
  private readonly logger = new Logger(ProtocolWebhookPublisher.name);

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async publishStateTransition(params: {
    sessionId: string;
    merchantId: string;
    agentId: string;
    previousState: string;
    newState: string;
    payload?: Record<string, unknown>;
    callbackUrl?: string;
  }): Promise<void> {
    const eventType = STATE_TO_EVENT[params.newState];
    if (!eventType) {
      this.logger.warn({
        msg: "No event type mapped for state",
        state: params.newState,
      });
      return;
    }

    const envelope: DomainEventEnvelope = {
      event_id: crypto.randomUUID(),
      event_type: eventType as any, // Protocol events extend the type union
      schema_version: 1,
      merchant_id: params.merchantId,
      occurred_at: new Date().toISOString(),
      correlation_id: params.sessionId,
      causation_id: `${params.previousState}_to_${params.newState}`,
      producer: "protocol" as any,
      payload: {
        event_type: `protocol.state_changed`,
        session_id: params.sessionId,
        agent_id: params.agentId,
        previous_state: params.previousState,
        new_state: params.newState,
        payload: params.payload ?? {},
        callback_url: params.callbackUrl ?? null,
        timestamp: new Date().toISOString(),
      },
    };

    await this.outbox.appendOutbox(envelope);

    this.logger.log({
      event: "protocol.webhook.published",
      sessionId: params.sessionId,
      eventType,
      previousState: params.previousState,
      newState: params.newState,
    });
  }

  async publishSessionExpired(params: {
    sessionId: string;
    merchantId: string;
    agentId: string;
    callbackUrl?: string;
  }): Promise<void> {
    const envelope: DomainEventEnvelope = {
      event_id: crypto.randomUUID(),
      event_type: "protocol.session_expired" as any,
      schema_version: 1,
      merchant_id: params.merchantId,
      occurred_at: new Date().toISOString(),
      correlation_id: params.sessionId,
      causation_id: "session_expired",
      producer: "protocol" as any,
      payload: {
        event_type: "protocol.session_expired",
        session_id: params.sessionId,
        agent_id: params.agentId,
        callback_url: params.callbackUrl ?? null,
        timestamp: new Date().toISOString(),
      },
    };

    await this.outbox.appendOutbox(envelope);
  }
}
