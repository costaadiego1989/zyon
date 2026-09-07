import type { DomainEventEnvelope } from "@zyon/shared-types";
import type { OnboardingStateEntity } from "../entities/onboarding-state.entity.js";

export const ONBOARDING_TRANSITION_REPOSITORY = Symbol("ONBOARDING_TRANSITION_REPOSITORY");

/** Persists a state transition and all of its events as one durable commit. */
export interface OnboardingTransitionRepository {
  persist(state: OnboardingStateEntity, events: DomainEventEnvelope[]): Promise<void>;
}
