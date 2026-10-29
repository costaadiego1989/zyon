import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface RecordExperimentResultInput {
  sessionId: string;
  merchantId: string;
  converted: boolean;
  revenue?: number;
  offersShown?: number;
  offersAccepted?: number;
  durationSeconds?: number;
}

@Injectable()
export class RecordExperimentResultUseCase {
  private readonly logger = new Logger(RecordExperimentResultUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: RecordExperimentResultInput): Promise<void> {
    const { sessionId, merchantId, converted, revenue, offersShown, offersAccepted, durationSeconds } = input;

    // Find the checkout session to get the variant ID
    const session = await this.prisma.checkoutSession.findFirst({
      where: {
        merchantId,
        sessionId,
      },
    });

    if (!session) {
      this.logger.warn(`Session not found: ${merchantId}/${sessionId}`);
      return;
    }

    // Results may only be attributed to the variant persisted when the
    // checkout began. Reassigning against whichever experiment is running now
    // can credit a buyer to an arm they never experienced.
    const variantId = session.promptVariantId ?? undefined;
    if (!variantId) {
      this.logger.debug(`No persisted experiment variant for session: ${sessionId}`);
      return;
    }

    // Record the result — idempotent via upsert on unique (variantId, sessionId)
    try {
      await (this.prisma as any).promptVariantResult.upsert({
        where: {
          variantId_sessionId: {
            variantId,
            sessionId,
          },
        },
        create: {
          variantId,
          sessionId,
          converted,
          revenue: revenue ?? null,
          offersShown: offersShown ?? 0,
          offersAccepted: offersAccepted ?? 0,
          durationSeconds: durationSeconds ?? null,
        },
        update: {
          converted,
          revenue: revenue ?? undefined,
          offersShown: offersShown ?? 0,
          offersAccepted: offersAccepted ?? 0,
          durationSeconds: durationSeconds ?? undefined,
        },
      });

      this.logger.log(
        `Recorded experiment result: variant=${variantId} session=${sessionId} converted=${converted}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to record experiment result: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
