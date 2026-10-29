import type { RecoveryStrategy } from "../values/recovery-strategy.js";
import type { AbandonmentReason } from "../values/abandonment-reason.js";

export type RecoveryAttemptStatus = "pending" | "sent" | "recovered" | "failed" | "expired" | "unknown";
export type RecoveryChannel = "in_session" | "none" | "whatsapp_template" | "email";

export interface RecoveryAttemptProps {
  id: string;
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  abandonmentReason: AbandonmentReason;
  abandonmentScore: number;
  strategy: RecoveryStrategy;
  channel: RecoveryChannel;
  sentAt: Date | null;
  status: RecoveryAttemptStatus;
  recoveredAt: Date | null;
  recoveredOrderId: string | null;
  createdAt: Date;
}

export class RecoveryAttempt {
  constructor(public readonly props: RecoveryAttemptProps) {}

  get id() { return this.props.id; }
  get merchantId() { return this.props.merchantId; }
  get sessionId() { return this.props.sessionId; }
  get globalUserId() { return this.props.globalUserId; }
  get abandonmentReason() { return this.props.abandonmentReason; }
  get abandonmentScore() { return this.props.abandonmentScore; }
  get strategy() { return this.props.strategy; }
  get channel() { return this.props.channel; }
  get sentAt() { return this.props.sentAt; }
  get status() { return this.props.status; }
  get recoveredAt() { return this.props.recoveredAt; }
  get recoveredOrderId() { return this.props.recoveredOrderId; }
  get createdAt() { return this.props.createdAt; }

  markSent(at: Date, channel: RecoveryChannel = this.props.channel): RecoveryAttempt {
    return new RecoveryAttempt({ ...this.props, status: "sent", sentAt: at, channel });
  }

  markRecovered(at: Date, orderId?: string): RecoveryAttempt {
    return new RecoveryAttempt({
      ...this.props,
      status: "recovered",
      recoveredAt: at,
      recoveredOrderId: orderId ?? null,
    });
  }

  markFailed(channel: RecoveryChannel = this.props.channel): RecoveryAttempt {
    return new RecoveryAttempt({ ...this.props, status: "failed", channel });
  }

  markUnknown(channel: RecoveryChannel = this.props.channel): RecoveryAttempt {
    return new RecoveryAttempt({ ...this.props, status: "unknown", channel });
  }

  markExpired(): RecoveryAttempt {
    return new RecoveryAttempt({ ...this.props, status: "expired" });
  }
}
