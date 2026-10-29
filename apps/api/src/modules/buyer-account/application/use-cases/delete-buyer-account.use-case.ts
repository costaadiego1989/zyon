import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BUYER_ACCOUNT_PORT, type BuyerAccountPort } from "../../domain/ports/buyer-account-port.js";

export interface DeleteBuyerAccountRequest {
  globalUserId: string;
}

export interface DeleteBuyerAccountResult {
  deleted: true;
  anonymizedPurchases: true;
}

interface AuditRecorder {
  record(event: Record<string, unknown>): Promise<void>;
}

/**
 * LGPD Art. 18 VI: deletion on request. Cascade-removes buyer PII while
 * preserving anonymized purchase records for merchant accounting/legal
 * obligations. Atomicity is guaranteed by the port implementation, which
 * runs every step in a single Prisma `$transaction`.
 */
@Injectable()
export class DeleteBuyerAccountUseCase {
  private readonly logger = new Logger(DeleteBuyerAccountUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_PORT) private readonly port: BuyerAccountPort,
    @Optional() @Inject("AUDIT_SERVICE") private readonly audit?: AuditRecorder,
  ) {}

  async execute(input: DeleteBuyerAccountRequest): Promise<DeleteBuyerAccountResult> {
    if (!input || !input.globalUserId) {
      throw new Error("buyer_account_missing_global_user_id");
    }

    await this.port.cascadeDelete({ globalUserId: input.globalUserId });
    await this.recordAudit(input.globalUserId);

    return { deleted: true, anonymizedPurchases: true };
  }

  private async recordAudit(globalUserId: string): Promise<void> {
    try {
      await this.audit?.record({
        merchantId: "__platform__",
        action: "buyer.account.deleted",
        resourceType: "buyer_account",
        resourceId: globalUserId,
        metadata: { reason: "lgpd_art18_vi" },
      });
    } catch (error) {
      this.logger.warn(`buyer_account_delete_audit_failed:${error}`);
    }
  }
}
