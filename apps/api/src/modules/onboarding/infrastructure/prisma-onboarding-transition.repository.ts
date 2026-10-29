import { Prisma, type PrismaClient } from "@prisma/client";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { appendOutboxInTransaction } from "../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";
import type { OnboardingStateEntity } from "../domain/entities/onboarding-state.entity.js";
import type { OnboardingTransitionRepository } from "../domain/ports/onboarding-transition.repository.port.js";

export class PrismaOnboardingTransitionRepository implements OnboardingTransitionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async persist(state: OnboardingStateEntity, events: DomainEventEnvelope[]): Promise<void> {
    const snapshot = state.toSnapshot();
    await this.prisma.$transaction(async (tx) => {
      await tx.merchantOnboardingState.upsert({
        where: { merchantId: snapshot.merchantId },
        create: { merchantId: snapshot.merchantId, steps: snapshot.steps as unknown as Prisma.InputJsonValue },
        update: { steps: snapshot.steps as unknown as Prisma.InputJsonValue },
      });
      for (const event of events) await appendOutboxInTransaction(tx, event);
    });
  }
}
