/**
 * Port for persisting email-change OTP codes.
 * Scoped to the auth module — does not share state with buyer-account OTP.
 */
export interface EmailChangeOtpRecord {
  userId: string;
  newEmail: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface EmailChangeOtpStore {
  /** Persist (or replace) the active OTP for a user's email change. */
  save(record: Omit<EmailChangeOtpRecord, "attempts" | "consumedAt">): Promise<void>;
  /** Find the active (non-expired, non-consumed) record for the user. */
  findActive(userId: string, now?: Date): Promise<EmailChangeOtpRecord | null>;
  /** Increment attempts atomically; returns the updated record or null. */
  incrementAttempts(userId: string): Promise<EmailChangeOtpRecord | null>;
  /** Mark consumed. */
  consume(userId: string, now?: Date): Promise<void>;
}

export const EMAIL_CHANGE_OTP_STORE = Symbol("EMAIL_CHANGE_OTP_STORE");
