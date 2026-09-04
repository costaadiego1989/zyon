/**
 * SettlementStateMachineService — Marketplace Settlement Lifecycle
 *
 * Manages settlement state transitions for cross-store order line items.
 * Enforces valid transitions, calculates window dates, validates configuration.
 */

export type SettlementStatus =
  | "awaiting_return_window"
  | "transfer_scheduled"
  | "transferred"
  | "finalized"
  | "return_cancelled"
  | "chargeback_cancelled"
  | "chargeback_debt";

export type SettlementEvent =
  | "return_window_expired"
  | "buyer_returned"
  | "transfer_executed"
  | "chargeback_received"
  | "chargeback_window_expired";

export interface SettlementWindows {
  returnWindowUntil: Date;
  transferScheduledAt: Date;
  chargebackWindowUntil: Date;
}

export interface MarketplaceWindowConfig {
  returnWindowDays: number;
  payoutDelayDays: number;
  chargebackWindowDays: number;
}

type TransitionMap = Record<SettlementStatus, Partial<Record<SettlementEvent, SettlementStatus>>>;

const TRANSITIONS: TransitionMap = {
  awaiting_return_window: {
    return_window_expired: "transfer_scheduled",
    buyer_returned: "return_cancelled",
    chargeback_received: "chargeback_cancelled",
  },
  transfer_scheduled: {
    transfer_executed: "transferred",
    chargeback_received: "chargeback_cancelled",
  },
  transferred: {
    chargeback_window_expired: "finalized",
    chargeback_received: "chargeback_debt",
  },
  finalized: {},
  return_cancelled: {},
  chargeback_cancelled: {},
  chargeback_debt: {},
};

export class SettlementStateMachineService {
  transition(current: SettlementStatus, event: SettlementEvent): SettlementStatus {
    const stateTransitions = TRANSITIONS[current];
    const next = stateTransitions[event];

    if (!next) {
      throw new Error(
        `Invalid transition: cannot apply event '${event}' to status '${current}'`
      );
    }

    return next;
  }

  calculateWindows(
    config: MarketplaceWindowConfig,
    orderDate: Date
  ): SettlementWindows {
    this.validateConfig(config);

    const returnWindowUntil = this.addDays(orderDate, config.returnWindowDays);
    const transferScheduledAt = this.addDays(
      returnWindowUntil,
      config.payoutDelayDays
    );
    const chargebackWindowUntil = this.addDays(
      orderDate,
      config.chargebackWindowDays
    );

    return { returnWindowUntil, transferScheduledAt, chargebackWindowUntil };
  }

  validateConfig(config: MarketplaceWindowConfig): void {
    if (
      !Number.isInteger(config.returnWindowDays) ||
      config.returnWindowDays < 1 ||
      config.returnWindowDays > 30
    ) {
      throw new Error("returnWindowDays must be an integer between 1 and 30");
    }

    if (
      !Number.isInteger(config.payoutDelayDays) ||
      config.payoutDelayDays < 1 ||
      config.payoutDelayDays > 30
    ) {
      throw new Error("payoutDelayDays must be an integer between 1 and 30");
    }

    if (
      !Number.isInteger(config.chargebackWindowDays) ||
      config.chargebackWindowDays < 7 ||
      config.chargebackWindowDays > 30
    ) {
      throw new Error(
        "chargebackWindowDays must be an integer between 7 and 30"
      );
    }
  }

  getAvailableEvents(current: SettlementStatus): SettlementEvent[] {
    const stateTransitions = TRANSITIONS[current];
    return Object.keys(stateTransitions) as SettlementEvent[];
  }

  isTerminal(status: SettlementStatus): boolean {
    return this.getAvailableEvents(status).length === 0;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    result.setDate(result.getDate() + days);
    return result;
  }
}
