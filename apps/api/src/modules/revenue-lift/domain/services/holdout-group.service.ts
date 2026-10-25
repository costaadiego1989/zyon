import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";

export interface HoldoutAssignment {
  globalUserId: string;
  merchantId: string;
  cohort: "holdout" | "treatment";
}

/**
 * Service for deterministic, per-merchant holdout group assignment.
 * Uses SHA256 hash of (globalUserId + salt) to ensure same user always
 * lands in same cohort.
 *
 * INVARIANT H2: Salt must always be "holdout_salt_v1" — never randomize.
 */
@Injectable()
export class HoldoutGroupService {
  // INVARIANT H2: never change this salt
  private readonly HOLDOUT_SALT = "holdout_salt_v1";
  private readonly HOLDOUT_PERCENT = 5;

  /**
   * Assign cohort deterministically.
   * Same (globalUserId, merchantId) always returns same cohort.
   */
  assignCohort(globalUserId: string, merchantId: string): "holdout" | "treatment" {
    const combined = globalUserId + merchantId + this.HOLDOUT_SALT;
    const hash = createHash("sha256").update(combined).digest("hex");
    const bucket = parseInt(hash.slice(0, 8), 16) % 100;
    return bucket < this.HOLDOUT_PERCENT ? "holdout" : "treatment";
  }

  /**
   * Get salt value. Used by tests to verify salt invariant (H2).
   */
  getSalt(): string {
    return this.HOLDOUT_SALT;
  }

  /**
   * Get holdout percent threshold. Used by tests to validate distribution.
   */
  getHoldoutPercent(): number {
    return this.HOLDOUT_PERCENT;
  }
}
