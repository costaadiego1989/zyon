import type {
  OnboardingStateResponse,
  OnboardingStepId,
  OnboardingStepState
} from "@zyon/shared-types";

/**
 * Ordered provisioning steps for self-serve tenant onboarding (ADR 0015).
 * Order is the resume order the guided wizard walks (ADR 0024).
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStepId[] = [
  "account",
  "checkout_config",
  "whatsapp",
  "ai_engine"
] as const;

/**
 * Legacy step ids that were replaced when the product moved from
 * embed/publish to whatsapp/ai_engine (steps 5 & 6). Used to grandfather
 * merchants who already finished the old flow so they aren't dropped back
 * into onboarding.
 */
const LEGACY_COMPLETED_STEP_IDS = ["embed", "publish"] as const;

export interface OnboardingStepSnapshot {
  status: "pending" | "completed";
  completedAt?: string;
}

export interface OnboardingStateSnapshot {
  merchantId: string;
  steps: Record<OnboardingStepId, OnboardingStepSnapshot>;
  createdAt: string;
  updatedAt: string;
}

function emptySteps(): Record<OnboardingStepId, OnboardingStepSnapshot> {
  return ONBOARDING_STEP_ORDER.reduce(
    (acc, id) => {
      acc[id] = { status: "pending" };
      return acc;
    },
    {} as Record<OnboardingStepId, OnboardingStepSnapshot>
  );
}

export function isOnboardingStepId(value: string): value is OnboardingStepId {
  return (ONBOARDING_STEP_ORDER as readonly string[]).includes(value);
}

/**
 * Aggregate for a tenant's onboarding progress. Pure domain: no I/O.
 * `completeStep` is idempotent so the orchestration can re-run on partial
 * failure without corrupting state.
 */
export class OnboardingStateEntity {
  private constructor(private readonly snapshot: OnboardingStateSnapshot) {}

  static create(merchantId: string, now: Date = new Date()): OnboardingStateEntity {
    const iso = now.toISOString();
    return new OnboardingStateEntity({
      merchantId,
      steps: emptySteps(),
      createdAt: iso,
      updatedAt: iso
    });
  }

  static rehydrate(snapshot: OnboardingStateSnapshot): OnboardingStateEntity {
    // Backfill any step missing from persisted data (forward-compatible).
    const persistedSteps = (snapshot.steps ?? {}) as Record<string, OnboardingStepSnapshot>;

    // Grandfather: a merchant who completed the legacy flow (embed + publish)
    // finished onboarding under the old product, so treat the steps that
    // replaced them (whatsapp + ai_engine) as completed instead of throwing
    // them back into the wizard.
    const finishedLegacyFlow = LEGACY_COMPLETED_STEP_IDS.every(
      (id) => persistedSteps[id]?.status === "completed"
    );

    const steps = emptySteps();
    for (const id of ONBOARDING_STEP_ORDER) {
      const persisted = persistedSteps[id];
      if (persisted) {
        steps[id] = { status: persisted.status, completedAt: persisted.completedAt };
      } else if (finishedLegacyFlow && (id === "whatsapp" || id === "ai_engine")) {
        steps[id] = { status: "completed", completedAt: snapshot.updatedAt };
      }
    }
    return new OnboardingStateEntity({ ...snapshot, steps });
  }

  get merchantId(): string {
    return this.snapshot.merchantId;
  }

  /** Returns true when the step transitioned from pending to completed. */
  completeStep(stepId: OnboardingStepId, now: Date = new Date()): boolean {
    const current = this.snapshot.steps[stepId];
    if (current.status === "completed") return false;
    this.snapshot.steps[stepId] = { status: "completed", completedAt: now.toISOString() };
    this.snapshot.updatedAt = now.toISOString();
    return true;
  }

  isComplete(): boolean {
    return ONBOARDING_STEP_ORDER.every((id) => this.snapshot.steps[id].status === "completed");
  }

  /** First pending step in canonical order, or undefined when fully complete. */
  nextStep(): OnboardingStepId | undefined {
    return ONBOARDING_STEP_ORDER.find((id) => this.snapshot.steps[id].status === "pending");
  }

  completedAt(): string | undefined {
    if (!this.isComplete()) return undefined;
    return ONBOARDING_STEP_ORDER.map((id) => this.snapshot.steps[id].completedAt).filter(Boolean).sort().at(-1);
  }

  toSnapshot(): OnboardingStateSnapshot {
    return {
      merchantId: this.snapshot.merchantId,
      steps: ONBOARDING_STEP_ORDER.reduce(
        (acc, id) => {
          acc[id] = { ...this.snapshot.steps[id] };
          return acc;
        },
        {} as Record<OnboardingStepId, OnboardingStepSnapshot>
      ),
      createdAt: this.snapshot.createdAt,
      updatedAt: this.snapshot.updatedAt
    };
  }

  toResponse(): OnboardingStateResponse {
    const steps: OnboardingStepState[] = ONBOARDING_STEP_ORDER.map((id) => ({
      id,
      status: this.snapshot.steps[id].status,
      completed_at: this.snapshot.steps[id].completedAt
    }));
    return {
      merchant_id: this.snapshot.merchantId,
      steps,
      completed: this.isComplete(),
      completed_at: this.completedAt(),
      next_step: this.nextStep()
    };
  }
}
