import type { MerchantCommerceConnection } from '../../../../commerce/domain/ports/commerce-connection.port.js';
import { CommerceConnectionResponse } from '../../presentation/http/dtos/commerce.dtos.js';

export class CommerceEntityMapper {
  static toResponse(
    connection: MerchantCommerceConnection,
  ): CommerceConnectionResponse {
    return {
      id: connection.merchantId,
      platform: connection.provider as any,
      store_url: connection.storeUrl,
      status: connection.status,
      last_sync_at: connection.lastSyncedAt ?? undefined,
      last_tested_at: connection.lastTestedAt ?? undefined,
      last_error_code: connection.lastErrorCode ?? undefined,
      created_at: connection.createdAt,
      updated_at: connection.updatedAt,
    };
  }
}
