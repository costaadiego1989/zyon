export const CRM_CONNECTION_REPOSITORY = Symbol("CRM_CONNECTION_REPOSITORY");

export interface CrmConnectionRow {
  id: string;
  merchantId: string;
  provider: string;
  status: string;
  accessTokenCipher: string | null;
  refreshTokenCipher?: string | null;
  tokenExpiresAt?: Date | null;
  config?: Record<string, unknown> | null;
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
}

export function publicCrmConnection(row: CrmConnectionRow) {
  const config = row.config ?? {};
  return {
    id: row.id, provider: row.provider, status: row.status,
    lastSyncAt: row.lastSyncAt, lastErrorCode: row.lastErrorCode,
    config: row.provider === "mailchimp" ? { audienceId: config.audienceId } :
      row.provider === "activecampaign" ? { apiUrl: config.apiUrl } : {},
  };
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
  updateOAuthTokens(merchantId: string, id: string, expectedAccessTokenCipher: string,
    tokens: { accessTokenCipher: string; refreshTokenCipher: string; tokenExpiresAt: Date }): Promise<boolean>;
  markSynced(merchantId: string, id: string): Promise<void>;
  markError(merchantId: string, id: string, errorCode: string): Promise<void>;
}
