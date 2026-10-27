import { ConflictException, Injectable } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { AcpStatusPolicy, type AcpDerivedStatus } from "./acp-status.policy.js";

const TERMINAL: ReadonlySet<AcpDerivedStatus> = new Set(["completed", "canceled"]);

/**
 * Guards checkout session mutations against terminal lifecycle states.
 * Delegates the status rule to {@link AcpStatusPolicy}.
 */
@Injectable()
export class AcpMutabilityPolicy {
  constructor(private readonly statusPolicy: AcpStatusPolicy) {}

  async assertMutable(session: CheckoutSession): Promise<void> {
    const status = await this.statusPolicy.derive(session);
    if (TERMINAL.has(status)) {
      throw new ConflictException({
        code: `acp_session_${status}`,
        message: `Cannot mutate a ${status} session`,
        current_status: status,
      });
    }
  }
}
