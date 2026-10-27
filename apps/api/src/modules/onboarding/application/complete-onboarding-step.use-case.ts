import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { DomainEventEnvelope, OnboardingDomainEventType, OnboardingStateResponse, OnboardingStepId } from "@zyon/shared-types";
import {
  ONBOARDING_STATE_REPOSITORY,
  type OnboardingStateRepository
} from "../domain/ports/onboarding-state.repository.port.js";
import {
  ONBOARDING_TRANSITION_REPOSITORY,
  type OnboardingTransitionRepository,
} from "../domain/ports/onboarding-transition.repository.port.js";
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
  // The logical transition, rather than its wall-clock retry, owns its event ID.
  const identity = JSON.stringify([input.merchantId, input.eventType, input.payload.step ?? "completed"]);
  const event_id = `evt_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;

  return {
    event_id,
    event_type: input.eventType,
    schema_version: 1,
    merchant_id: input.merchantId,
    occurred_at: occurredAtStr,
    correlation_id: `corr_${randomUUID()}`,
    causation_id: input.eventType,
    producer: "onboarding",
    payload: input.payload
  };
}

@Injectable()
export class CompleteOnboardingStepUseCase {
  constructor(
    @Inject(ONBOARDING_STATE_REPOSITORY) private readonly repository: OnboardingStateRepository,
    @Inject(ONBOARDING_TRANSITION_REPOSITORY) private readonly transitions: OnboardingTransitionRepository,
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
      const events = [
        onboardingEvent({
          eventType: "merchant.onboarding.step.completed",
          merchantId,
          payload: { step },
          occurredAt: now
        }),
      ];
      if (state.isComplete()) {
        events.push(
          onboardingEvent({
            eventType: "merchant.onboarding.completed",
            merchantId,
            payload: { completed_at: state.completedAt() },
            occurredAt: now
          })
        );
      }
      await this.transitions.persist(state, events);
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
