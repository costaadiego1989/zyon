import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { assertInterventionRecord } from "../domain/entities/intervention-record.entity.js";
import type { CheckoutInterventionLedgerPort } from "../domain/ports/checkout-intervention-ledger.port.js";

@Injectable()
export class PrismaInterventionLedgerRepository implements CheckoutInterventionLedgerPort {
  constructor(private readonly prisma: PrismaClient) {}

  async countForSession(merchantId: string, sessionId: string): Promise<number> {
    return this.prisma.checkoutIntervention.count({
      where: { merchantId, sessionId }
    });
  }

  async lastOccurredAt(merchantId: string, sessionId: string): Promise<number | null> {
    const row = await this.prisma.checkoutIntervention.findFirst({
      where: { merchantId, sessionId },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true }
    });
    return row ? Math.floor(row.occurredAt.getTime() / 1000) : null;
  }

  async record(input: Parameters<CheckoutInterventionLedgerPort["record"]>[0]): Promise<void> {
    assertInterventionRecord(input);
    const occurredAt = new Date(input.occurredAtUnix * 1000);
    await this.prisma.checkoutIntervention.create({
      data: {
        merchantId: input.merchantId.trim(),
        sessionId: input.sessionId.trim(),
        occurredAt,
        reason: input.reason
      }
    });
  }
}
