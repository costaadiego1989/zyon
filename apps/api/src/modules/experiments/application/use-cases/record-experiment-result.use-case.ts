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

    // Resolve the variant this session belongs to. Prefer the persisted
    // promptVariantId; when absent (storefront sessions never persisted it),
    // fall back to the SAME deterministic djb2 hash used at assignment time
    // (start-store-conversation, storefront /events, send-chat-message). This
    // closes the A/B loop so a real conversion + revenue is credited to the
    // exact variant the buyer experienced.
    let variantId = session.promptVariantId ?? undefined;
    if (!variantId) {
      variantId = await this.resolveVariantByHash(merchantId, sessionId);
    }
    if (!variantId) {
      this.logger.debug(`No variant resolvable for session: ${sessionId} (no running experiment)`);
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

  /**
   * Fallback variant resolution for sessions without a persisted promptVariantId.
   * Finds the running experiment and picks a variant with the SAME djb2 hash used
   * at assignment time (start-store-conversation / storefront /events /
   * send-chat-message), so the credited variant matches the one the buyer saw.
   */
  private async resolveVariantByHash(merchantId: string, sessionId: string): Promise<string | undefined> {
    const running = await (this.prisma as any).promptExperiment.findFirst({
      where: { merchantId, status: "running" },
      include: { variants: true },
    });
    if (!running || !running.variants?.length) return undefined;

    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
      hash |= 0;
    }
    const totalWeight = running.variants.reduce((sum: number, v: any) => sum + (v.weight || 1), 0);
    let target = Math.abs(hash) % totalWeight;
    for (const variant of running.variants) {
      target -= (variant.weight || 1);
      if (target <= 0) return variant.id;
    }
    return running.variants[running.variants.length - 1].id;
  }
}
