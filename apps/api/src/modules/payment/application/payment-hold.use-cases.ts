import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";

const HOLD_DAYS = 14; // CDC brasileiro — prazo de arrependimento

export interface PlatformFeeConfig {
  transactionFeePercent: number;
}

@Injectable()
export class CreatePaymentHoldUseCase {
  private readonly logger = new Logger(CreatePaymentHoldUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: {
    merchantId: string;
    paymentIntentId: string;
    orderId?: string;
    totalAmountCents: number;
    feeConfig: PlatformFeeConfig;
  }): Promise<{ holdId: string; holdUntil: Date; platformFeeCents: number; merchantNetCents: number }> {
    const { merchantId, paymentIntentId, orderId, totalAmountCents, feeConfig } = input;

    const platformFeeCents = Math.round(totalAmountCents * feeConfig.transactionFeePercent / 100);
    const merchantNetCents = totalAmountCents - platformFeeCents;
    const holdUntil = new Date(Date.now() + HOLD_DAYS * 86_400_000);

    const hold = await (this.prisma as any).paymentHold.upsert({
      where: { paymentIntentId },
      create: {
        merchantId,
        paymentIntentId,
        orderId,
        totalAmountCents,
        platformFeeCents,
        merchantNetCents,
        status: "held",
        holdUntil,
      },
      update: {},
    });

    this.logger.log(`Hold created: ${hold.id} for merchant ${merchantId}, release at ${holdUntil.toISOString()}`);
    return { holdId: hold.id, holdUntil, platformFeeCents, merchantNetCents };
  }
}

@Injectable()
export class ReleasePaymentHoldsUseCase {
  private readonly logger = new Logger(ReleasePaymentHoldsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(): Promise<{ released: number }> {
    const now = new Date();

    // Atomic: updateMany with WHERE status='held' AND holdUntil <= now
    // Prevents race condition with concurrent workers releasing same hold
    const result = await (this.prisma as any).paymentHold.updateMany({
      where: { status: "held", holdUntil: { lte: now } },
      data: { status: "released", releasedAt: now },
    });

    const released = result.count ?? 0;
    if (released > 0) {
      this.logger.log(`Released ${released} payment holds`);
    }
    return { released };
  }
}

@Injectable()
export class RefundPaymentHoldUseCase {
  private readonly logger = new Logger(RefundPaymentHoldUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(paymentIntentId: string): Promise<void> {
    const hold = await (this.prisma as any).paymentHold.findUnique({
      where: { paymentIntentId },
    });
    if (!hold || hold.status !== "held") return;

    await (this.prisma as any).paymentHold.update({
      where: { id: hold.id },
      data: { status: "refunded" },
    });
    this.logger.log(`Hold ${hold.id} marked as refunded`);
  }
}

@Injectable()
export class ChargebackPaymentHoldUseCase {
  private readonly logger = new Logger(ChargebackPaymentHoldUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(paymentIntentId: string): Promise<void> {
    const hold = await (this.prisma as any).paymentHold.findUnique({
      where: { paymentIntentId },
    });
    if (!hold) return;

    await (this.prisma as any).paymentHold.update({
      where: { id: hold.id },
      data: { status: "chargebacked" },
    });
    this.logger.log(`Hold ${hold.id} marked as chargebacked`);
  }
}
