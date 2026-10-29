import { OnboardingStateEntity } from "../domain/entities/onboarding-state.entity.js";
import type { OnboardingStateRepository } from "../domain/ports/onboarding-state.repository.port.js";

/**
 * Test double only. Runtime persistence is Prisma (see project invariants).
 * Constructed directly in specs, never wired into module roots.
 */
export class InMemoryOnboardingStateRepository implements OnboardingStateRepository {
  private readonly byMerchant = new Map<string, ReturnType<OnboardingStateEntity["toSnapshot"]>>();

  findByMerchant(merchantId: string): OnboardingStateEntity | null {
    const snapshot = this.byMerchant.get(merchantId);
    return snapshot ? OnboardingStateEntity.rehydrate(snapshot) : null;
  }

  save(state: OnboardingStateEntity): OnboardingStateEntity {
    this.byMerchant.set(state.merchantId, state.toSnapshot());
    return state;
  }
}
