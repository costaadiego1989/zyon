export const VOICE_SESSION_QUOTA_REPOSITORY = Symbol("VOICE_SESSION_QUOTA_REPOSITORY");

export type VoiceSessionState = "reserved" | "created" | "reconciliation_required" | "released";

export type VoiceSessionReservation = {
  id: string;
  merchantId: string;
  periodStart: Date;
  idempotencyKey: string;
  requestFingerprint: string;
  state: VoiceSessionState;
};

export type VoiceSessionQuotaPeriod = {
  start: Date;
  end: Date;
};

export type ReserveVoiceSessionInput = {
  merchantId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  period: VoiceSessionQuotaPeriod;
  limit: number;
};

export type ReserveVoiceSessionResult =
  | { status: "reserved"; reservation: VoiceSessionReservation }
  | { status: "already_reserved"; reservation: VoiceSessionReservation }
  | { status: "idempotency_conflict" }
  | { status: "limit_exceeded"; used: number };

export interface VoiceSessionQuotaRepository {
  reserve(input: ReserveVoiceSessionInput): Promise<ReserveVoiceSessionResult>;
  markProviderCallCreated(sessionId: string): Promise<void>;
  markProviderCallUnknown(sessionId: string): Promise<void>;
  releaseBeforeProviderCall(sessionId: string): Promise<void>;
}
