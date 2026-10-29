export interface IdempotencyClaimInput {
  merchantId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  method: string;
  route: string;
  expiresAt: Date;
}

export interface IdempotencyReplay {
  statusCode: number;
  responseBody: unknown;
  responseHeaders: Record<string, string>;
}

export type IdempotencyClaim =
  | { outcome: "acquired"; recordId: string }
  | { outcome: "replay"; replay: IdempotencyReplay }
  | { outcome: "payload_mismatch" }
  | { outcome: "in_progress" };

export interface IdempotencyRepository {
  claim(input: IdempotencyClaimInput): Promise<IdempotencyClaim>;
  complete(
    recordId: string,
    merchantId: string,
    requestFingerprint: string,
    replay: IdempotencyReplay,
  ): Promise<void>;
  release(
    recordId: string,
    merchantId: string,
    requestFingerprint: string,
  ): Promise<void>;
}
