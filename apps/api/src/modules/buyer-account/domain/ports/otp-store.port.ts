/**
 * Port for persistent OTP storage (buyer-account ADR B3).
 * Implementations: InMemoryOtpStore (tests), PrismaOtpStore (runtime).
 * The interface is intentionally minimal — store, find, consume, increment attempts.
 */
export interface OtpRecord {
  phone: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface OtpStore {
  /** Persist a new (or replace existing) OTP for the phone number. */
  save(record: Omit<OtpRecord, "attempts" | "consumedAt">): Promise<void>;
  /** Find an active (non-expired, non-consumed) OTP record for the phone. */
  findActive(phone: string, now?: Date): Promise<OtpRecord | null>;
  /** Atomically increment the attempt counter, returning the updated record. */
  incrementAttempts(phone: string): Promise<OtpRecord | null>;
  /** Mark the OTP consumed so it cannot be reused. */
  consume(phone: string, now?: Date): Promise<void>;
}

export const OTP_STORE = Symbol("OTP_STORE");
