import { Inject, Injectable , Logger} from "@nestjs/common";
import type { NegotiationResult } from "@zyon/negotiation-engine";
import { NEGOTIATION_STORE, type NegotiationStore } from "../domain/ports/negotiation-store.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class RecordNegotiationSessionUseCase {
  private readonly logger = new Logger(RecordNegotiationSessionUseCase.name);

  constructor(@Inject(NEGOTIATION_STORE) private readonly store: NegotiationStore) {}

  async execute(input: {
    merchantId: string;
    globalUserId?: string;
    cartFingerprint: string;
    result: NegotiationResult;
  }): Promise<{ negotiation_session_id: string }> {
    // Bug 6 fix: use atomic createNegotiationSessionWithLedger so session and
    // ledger entry either both commit or both roll back (no drift).
    const { id } = await this.store.createNegotiationSessionWithLedger({
      merchantId: input.merchantId,
      globalUserId: input.globalUserId,
      cartFingerprint: input.cartFingerprint,
      result: input.result
    });

    return { negotiation_session_id: id };
  }
}
