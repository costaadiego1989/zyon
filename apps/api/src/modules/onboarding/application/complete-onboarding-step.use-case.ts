import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { DomainEventEnvelope, OnboardingDomainEventType, OnboardingStateResponse, OnboardingStepId } from "@aacp/shared-types";
import {
  ONBOARDING_STATE_REPOSITORY,
  type OnboardingStateRepository
} from "../domain/ports/onboarding-state.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
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
}): DomainEventEnvelope {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    event_type: input.eventType,
    schema_version: 1,
    merchant_id: input.merchantId,
    occurred_at: new Date().toISOString(),
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
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: CompleteOnboardingStepInput): Promise<OnboardingStateResponse> {
    const merchantId = input.merchantId?.trim();
    if (!merchantId) throw new BadRequestException("onboarding_merchant_required");
    const step = input.step?.trim();
    if (!step || !isOnboardingStepId(step)) throw new BadRequestException("onboarding_step_invalid");

    const state =
      (await this.repository.findByMerchant(merchantId)) ?? withAccount(OnboardingStateEntity.create(merchantId));

    // Enforce canonical step order: all predecessors must be completed first.
    const currentIndex = ONBOARDING_STEP_ORDER.indexOf(step as OnboardingStepId);
    const response = state.toResponse();
    for (let i = 0; i < currentIndex; i++) {
      const predecessor = ONBOARDING_STEP_ORDER[i];
      const predecessorState = response.steps.find((s) => s.id === predecessor);
      if (predecessorState?.status !== "completed") {
        throw new BadRequestException("onboarding_step_out_of_order");
      }
    }

    const changed = state.completeStep(step as OnboardingStepId);

    // Idempotent: persist + emit only on a real transition, so re-runs after a
    // partial failure never duplicate events.
    if (changed) {
      await this.repository.save(state);
      await this.outbox.appendOutbox(
        onboardingEvent({
          eventType: "merchant.onboarding.step.completed",
          merchantId,
          payload: { step }
        })
      );
      if (state.isComplete()) {
        await this.outbox.appendOutbox(
          onboardingEvent({
            eventType: "merchant.onboarding.completed",
            merchantId,
            payload: { completed_at: state.completedAt() }
          })
        );
      }
    }

    return state.toResponse();
  }
}

function withAccount(state: OnboardingStateEntity): OnboardingStateEntity {
  state.completeStep("account");
  return state;
}
