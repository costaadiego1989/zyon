export const CRM_CONNECTION_REPOSITORY = Symbol("CRM_CONNECTION_REPOSITORY");

export interface CrmConnectionRow {
  id: string;
  merchantId: string;
  provider: string;
  status: string;
  accessTokenCipher: string | null;
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
}

export interface CrmConnectionRepositoryPort {
  list(merchantId: string): Promise<CrmConnectionRow[]>;
  findByProvider(merchantId: string, provider: string): Promise<CrmConnectionRow | null>;
  upsert(
    merchantId: string,
    provider: string,
    data: { status: string; accessTokenCipher?: string; refreshTokenCipher?: string; tokenExpiresAt?: Date; config?: Record<string, unknown> }
  ): Promise<CrmConnectionRow>;
  delete(merchantId: string, id: string): Promise<void>;
  markSynced(merchantId: string, id: string): Promise<void>;
  markError(merchantId: string, id: string, errorCode: string): Promise<void>;
}
