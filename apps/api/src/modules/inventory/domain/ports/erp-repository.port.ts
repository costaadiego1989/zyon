export const ERP_REPOSITORY = Symbol("ERP_REPOSITORY");

export interface ErpConnectionRow {
  id: string;
  merchantId: string;
  provider: string;
  status: string;
  accessTokenCipher: string | null;
  refreshTokenCipher: string | null;
  tokenExpiresAt: Date | null;
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
  config: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ErpRepositoryPort {
  list(merchantId: string): Promise<ErpConnectionRow[]>;
  findByProvider(merchantId: string, provider: string): Promise<ErpConnectionRow | null>;
  upsert(
    merchantId: string,
    provider: string,
    data: {
      status: string;
      accessTokenCipher?: string;
      refreshTokenCipher?: string;
      tokenExpiresAt?: Date;
      config?: Record<string, unknown>;
    }
  ): Promise<ErpConnectionRow>;
  delete(merchantId: string, id: string): Promise<void>;
  markSynced(merchantId: string, id: string): Promise<void>;
  markError(merchantId: string, id: string, errorCode: string): Promise<void>;
}
