import { Inject, Injectable } from "@nestjs/common";
import { BUYER_ACCOUNT_PORT, type BuyerAccountPort } from "../../domain/ports/buyer-account-port.js";

export interface DeleteBuyerAccountRequest {
  globalUserId: string;
}

export interface DeleteBuyerAccountResult {
  deleted: true;
  anonymizedPurchases: true;
}

/**
 * LGPD Art. 18 VI: deletion on request. Cascade-removes buyer PII while
 * preserving anonymized purchase records for merchant accounting/legal
 * obligations. Atomicity is guaranteed by the port implementation, which
 * runs every step in a single Prisma `$transaction`.
 */
@Injectable()
export class DeleteBuyerAccountUseCase {
  constructor(@Inject(BUYER_ACCOUNT_PORT) private readonly port: BuyerAccountPort) {}

  async execute(input: DeleteBuyerAccountRequest): Promise<DeleteBuyerAccountResult> {
    if (!input || !input.globalUserId) {
      throw new Error("buyer_account_missing_global_user_id");
    }

    await this.port.cascadeDelete({ globalUserId: input.globalUserId });

    return { deleted: true, anonymizedPurchases: true };
  }
}
