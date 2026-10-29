import { Prisma, type PrismaClient } from "@prisma/client";
import {
  OnboardingStateEntity,
  type OnboardingStateSnapshot,
  type OnboardingStepSnapshot
} from "../domain/entities/onboarding-state.entity.js";
import type { OnboardingStateRepository } from "../domain/ports/onboarding-state.repository.port.js";
import type { OnboardingStepId } from "@zyon/shared-types";

export class PrismaOnboardingStateRepository implements OnboardingStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByMerchant(merchantId: string): Promise<OnboardingStateEntity | null> {
    const row = await this.prisma.merchantOnboardingState.findUnique({ where: { merchantId } });
    if (!row) return null;
    return OnboardingStateEntity.rehydrate({
      merchantId: row.merchantId,
      steps: (row.steps ?? {}) as unknown as Record<OnboardingStepId, OnboardingStepSnapshot>,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    });
  }

  async save(state: OnboardingStateEntity): Promise<OnboardingStateEntity> {
    const snapshot: OnboardingStateSnapshot = state.toSnapshot();
    const steps = snapshot.steps as unknown as Prisma.InputJsonValue;
    await this.prisma.merchantOnboardingState.upsert({
      where: { merchantId: snapshot.merchantId },
      create: { merchantId: snapshot.merchantId, steps },
      update: { steps }
    });
    return state;
  }
}
