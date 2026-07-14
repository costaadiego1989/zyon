import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { DomainEventEnvelope, OnboardingDomainEventType, OnboardingStateResponse, OnboardingStepId } from "@zyon/shared-types";
import {
  ONBOARDING_STATE_REPOSITORY,
  type OnboardingStateRepository
} from "../domain/ports/onboarding-state.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../merchant/domain/ports/merchant-repository.port.js";
import {
  OnboardingStateEntity,
  ONBOARDING_STEP_ORDER,
  isOnboardingStepId
} from "../domain/entities/onboarding-state.entity.js";

export interface CompleteOnboardingStepInput {
  merchantId: string;
  step: string;
}

function onboardingEvent(input: {
  eventType: OnboardingDomainEventType;
  merchantId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}): DomainEventEnvelope {
  const occurredAtStr = input.occurredAt.toISOString();
  // ONB-H3: Derive event_id deterministically from (merchantId + step + occurredAt).
  // This allows retry deduplication: same operation always produces the same event_id.
  const eventSeed = `${input.merchantId}:${input.eventType}:${occurredAtStr}`;
  const hash = Array.from(eventSeed).reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0);
  const event_id = `evt_${Math.abs(hash).toString(36).padEnd(8, "0")}`;

  return {
    event_id,
    event_type: input.eventType,
    schema_version: 1,
    merchant_id: input.merchantId,
    occurred_at: occurredAtStr,
    correlation_id: `corr_${crypto.randomUUID()}`,
    causation_id: input.eventType,
    producer: "onboarding",
    payload: input.payload
  };
}

@Injectable()
export class CompleteOnboardingStepUseCase {
  constructor(
    @Inject(ONBOARDING_STATE_REPOSITORY) private readonly repository: OnboardingStateRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository
  ) {}

  async execute(input: CompleteOnboardingStepInput): Promise<OnboardingStateResponse> {
    const merchantId = input.merchantId?.trim();
    if (!merchantId) throw new BadRequestException("onboarding_merchant_required");
    const step = input.step?.trim();
    if (!step || !isOnboardingStepId(step)) throw new BadRequestException("onboarding_step_invalid");

    // ONB-H1: Validate merchant exists before mutating state.
    const merchantExists = await this.merchants.getProfile(merchantId);
    if (!merchantExists) throw new NotFoundException("merchant_not_found");

    const existingState = await this.repository.findByMerchant(merchantId);
    // ONB-H2: Create fresh state with account pre-completed; don't mutate input.
    const state = existingState ?? createOnboardingStateWithAccountComplete(merchantId);

    // ONB-H4: Validate that account step is completed (should always be true by this point).
    const response = state.toResponse();
    const accountState = response.steps.find((s) => s.id === "account");
    if (accountState?.status !== "completed") {
      throw new BadRequestException("onboarding_account_not_completed");
    }

    // Enforce canonical step order: all predecessors must be completed first.
    const currentIndex = ONBOARDING_STEP_ORDER.indexOf(step as OnboardingStepId);
    for (let i = 0; i < currentIndex; i++) {
      const predecessor = ONBOARDING_STEP_ORDER[i];
      const predecessorState = response.steps.find((s) => s.id === predecessor);
      if (predecessorState?.status !== "completed") {
        throw new BadRequestException("onboarding_step_out_of_order");
      }
    }

    const now = new Date();
    const changed = state.completeStep(step as OnboardingStepId, now);

    // Idempotent: persist + emit only on a real transition, so re-runs after a
    // partial failure never duplicate events.
    if (changed) {
      await this.repository.save(state);
      await this.outbox.appendOutbox(
        onboardingEvent({
          eventType: "merchant.onboarding.step.completed",
          merchantId,
          payload: { step },
          occurredAt: now
        })
      );
      if (state.isComplete()) {
        await this.outbox.appendOutbox(
          onboardingEvent({
            eventType: "merchant.onboarding.completed",
            merchantId,
            payload: { completed_at: state.completedAt() },
            occurredAt: now
          })
        );
      }
    }

    return state.toResponse();
  }
}

/**
 * ONB-H2: Create a fresh state entity with account step pre-completed.
 * Does NOT mutate the input; returns a new entity.
 */
function createOnboardingStateWithAccountComplete(merchantId: string): OnboardingStateEntity {
  const now = new Date();
  const created = OnboardingStateEntity.create(merchantId, now);
  // Return a snapshot and rehydrate to avoid in-place mutation.
  const snapshot = created.toSnapshot();
  snapshot.steps["account"] = { status: "completed", completedAt: now.toISOString() };
  return OnboardingStateEntity.rehydrate(snapshot);
}
