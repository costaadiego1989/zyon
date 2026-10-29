import { Injectable } from "@nestjs/common";
import { assertInterventionRecord } from "../domain/entities/intervention-record.entity.js";
import type { CheckoutInterventionLedgerPort } from "../domain/ports/checkout-intervention-ledger.port.js";

type Row = {
  merchantId: string;
  sessionId: string;
  occurredAtUnix: number;
};

@Injectable()
export class InMemoryInterventionLedger implements CheckoutInterventionLedgerPort {
  private rows: Row[] = [];

  countForSession(merchantId: string, sessionId: string): number {
    return this.rows.filter((r) => r.merchantId === merchantId && r.sessionId === sessionId).length;
  }

  lastOccurredAt(merchantId: string, sessionId: string): number | null {
    const slice = this.rows.filter((r) => r.merchantId === merchantId && r.sessionId === sessionId);
    if (!slice.length) return null;
    return Math.max(...slice.map((r) => r.occurredAtUnix));
  }

  async record(input: Parameters<CheckoutInterventionLedgerPort["record"]>[0]): Promise<void> {
    assertInterventionRecord(input);
    this.rows.push({
      merchantId: input.merchantId.trim(),
      sessionId: input.sessionId.trim(),
      occurredAtUnix: input.occurredAtUnix
    });
  }
}
