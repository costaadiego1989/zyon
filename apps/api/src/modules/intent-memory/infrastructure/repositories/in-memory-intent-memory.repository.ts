import type { BuyerIntentMemoryConsent, CustomerIntentRecord } from "@zyon/shared-types";
import type { IntentMemoryRepositoryPort } from "../../domain/ports/intent-memory-repository.port.js";

export class InMemoryIntentMemoryRepository implements IntentMemoryRepositoryPort {
  private records: CustomerIntentRecord[] = [];

  async save(record: CustomerIntentRecord): Promise<void> {
    const idx = this.records.findIndex(
      (r) => r.merchant_id === record.merchant_id && r.global_user_id === record.global_user_id
    );
    if (idx >= 0) {
      this.records[idx] = record;
    } else {
      this.records.push(record);
    }
  }

  async getLatest(merchantId: string, globalUserId: string): Promise<CustomerIntentRecord | null> {
    return (
      this.records
        .filter((r) => r.merchant_id === merchantId && r.global_user_id === globalUserId)
        .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime())
        .at(0) ?? null
    );
  }

  async findByMerchantId(merchantId: string): Promise<CustomerIntentRecord[]> {
    return this.records.filter((r) => r.merchant_id === merchantId);
  }
}
