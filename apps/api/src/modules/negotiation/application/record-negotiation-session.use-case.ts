import { Inject, Injectable } from "@nestjs/common";
import type { NegotiationResult } from "@aacp/negotiation-engine";
import { NEGOTIATION_STORE, type NegotiationStore } from "../domain/ports/negotiation-store.port.js";

@Injectable()
export class RecordNegotiationSessionUseCase {
  constructor(@Inject(NEGOTIATION_STORE) private readonly store: NegotiationStore) {}

  async execute(input: {
    merchantId: string;
    globalUserId?: string;
    cartFingerprint: string;
    result: NegotiationResult;
  }): Promise<{ negotiation_session_id: string }> {
    const { id } = await this.store.createNegotiationSession({
      merchantId: input.merchantId,
      globalUserId: input.globalUserId,
      cartFingerprint: input.cartFingerprint,
      result: input.result
    });

    await this.store.appendNegotiationLedgerEntry({
      merchantId: input.merchantId,
      negotiationSessionId: id,
      eventType: "negotiation.evaluated",
      amountCents: input.result.estimatedAiCostCents
    });

    return { negotiation_session_id: id };
  }
}
