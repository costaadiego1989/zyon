import type { PlatformOperator, PlatformPrincipal } from "../platform-operator.js";

export const PLATFORM_OPERATOR_REPOSITORY = Symbol("PLATFORM_OPERATOR_REPOSITORY");

export type PlatformSessionRecord = PlatformPrincipal & {
  id: string;
  familyId: string;
  authVersion: number;
  refreshExpiresAt: Date;
};

export interface PlatformOperatorRepository {
  findByEmail(email: string): Promise<PlatformOperator | undefined>;
  createSession(input: PlatformSessionRecord): Promise<boolean>;
  findActiveSession(id: string, now: Date): Promise<PlatformSessionRecord | undefined>;
  rotateSession(id: string, replacement: PlatformSessionRecord, now: Date): Promise<boolean>;
  revokeSessionFamily(id: string, now: Date): Promise<void>;
}
