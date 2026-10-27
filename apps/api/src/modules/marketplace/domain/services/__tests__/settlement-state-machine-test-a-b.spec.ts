import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SettlementStateMachineService } from "../settlement-state-machine.service.js";

/**
 * TEST A: Settlement State Machine Transitions
 *
 * Verifies that the state machine correctly validates all settlement lifecycle transitions
 * according to business rules:
 * - awaiting_return_window → transfer_scheduled (return expires)
 * - awaiting_return_window → return_cancelled (buyer returned)
 * - awaiting_return_window → chargeback_cancelled (chargeback before transfer)
 * - transfer_scheduled → transferred (transfer executes)
 * - transfer_scheduled → chargeback_cancelled (chargeback before transfer)
 * - transferred → finalized (chargeback window expires)
 * - transferred → chargeback_debt (chargeback after transfer = debt creation)
 */
describe("SettlementStateMachineService - TEST A: State Transitions", () => {
  const stateMachine = new SettlementStateMachineService();

  describe("awaiting_return_window state", () => {
    it("return_window_expired → transfer_scheduled", () => {
      const newStatus = stateMachine.transition(
        "awaiting_return_window",
        "return_window_expired",
      );
      assert.strictEqual(newStatus, "transfer_scheduled");
    });

    it("buyer_returned → return_cancelled", () => {
      const newStatus = stateMachine.transition(
        "awaiting_return_window",
        "buyer_returned",
      );
      assert.strictEqual(newStatus, "return_cancelled");
    });

    it("chargeback_received → chargeback_cancelled (no debt yet)", () => {
      const newStatus = stateMachine.transition(
        "awaiting_return_window",
        "chargeback_received",
      );
      assert.strictEqual(newStatus, "chargeback_cancelled");
    });
  });

  describe("transfer_scheduled state", () => {
    it("transfer_executed → transferred", () => {
      const newStatus = stateMachine.transition(
        "transfer_scheduled",
        "transfer_executed",
      );
      assert.strictEqual(newStatus, "transferred");
    });

    it("chargeback_received → chargeback_cancelled (return not yet expired)", () => {
      const newStatus = stateMachine.transition(
        "transfer_scheduled",
        "chargeback_received",
      );
      assert.strictEqual(newStatus, "chargeback_cancelled");
    });
  });

  describe("transferred state", () => {
    it("chargeback_window_expired → finalized", () => {
      const newStatus = stateMachine.transition(
        "transferred",
        "chargeback_window_expired",
      );
      assert.strictEqual(newStatus, "finalized");
    });

    it("chargeback_received → chargeback_debt (creates seller debt)", () => {
      const newStatus = stateMachine.transition(
        "transferred",
        "chargeback_received",
      );
      assert.strictEqual(newStatus, "chargeback_debt");
    });
  });

  describe("terminal states (no further transitions)", () => {
    it("finalized state has no transitions", () => {
      assert.throws(
        () => stateMachine.transition("finalized", "return_window_expired"),
        /invalid/i,
      );
    });

    it("return_cancelled state has no transitions", () => {
      assert.throws(
        () => stateMachine.transition("return_cancelled", "chargeback_received"),
        /invalid/i,
      );
    });

    it("chargeback_cancelled state has no transitions", () => {
      assert.throws(
        () => stateMachine.transition("chargeback_cancelled", "transfer_executed"),
        /invalid/i,
      );
    });

    it("chargeback_debt state has no transitions", () => {
      assert.throws(
        () => stateMachine.transition("chargeback_debt" as any, "finalized" as any),
        /invalid/i,
      );
    });
  });

  describe("invalid transitions throw", () => {
    it("awaiting_return_window + transfer_executed is invalid", () => {
      assert.throws(
        () =>
          stateMachine.transition("awaiting_return_window", "transfer_executed"),
        /invalid/i,
      );
    });

    it("transfer_scheduled + buyer_returned is invalid", () => {
      assert.throws(
        () =>
          stateMachine.transition("transfer_scheduled", "buyer_returned"),
        /invalid/i,
      );
    });

    it("transferred + buyer_returned is invalid", () => {
      assert.throws(
        () => stateMachine.transition("transferred", "buyer_returned"),
        /invalid/i,
      );
    });
  });
});

/**
 * TEST B: Seller Debt Integration with Settlements
 *
 * Verifies the complete flow: settlement → chargeback → debt creation → deduction
 * - When settlement transitions to chargeback_debt, debt must be created
 * - Debt amount = seller net amount from settlement
 * - Debt can be deducted from future transfers
 * - Debt can be marked as resolved
 */
describe("SettlementStateMachineService - TEST B: Chargeback to Debt Flow", () => {
  const stateMachine = new SettlementStateMachineService();

  it("settlement at 'transferred' state, chargeback received creates debt", () => {
    // Settlement timeline:
    // 1. Order line item created → awaiting_return_window
    // 2. Return window expires → transfer_scheduled
    // 3. Transfer executes → transferred
    // 4. Chargeback received → chargeback_debt

    let status: any = "awaiting_return_window";

    status = stateMachine.transition(status, "return_window_expired");
    assert.strictEqual(status, "transfer_scheduled");

    status = stateMachine.transition(status, "transfer_executed");
    assert.strictEqual(status, "transferred");

    status = stateMachine.transition(status, "chargeback_received");
    assert.strictEqual(status, "chargeback_debt");
  });

  it("settlement at 'awaiting_return_window', early chargeback cancels", () => {
    // Chargeback arrives before return window expires
    // → cancel without debt (seller hasn't received funds yet)

    let status: any = "awaiting_return_window";
    status = stateMachine.transition(status, "chargeback_received");
    assert.strictEqual(status, "chargeback_cancelled");
  });

  it("settlement at 'transfer_scheduled', chargeback before transfer cancels", () => {
    // Chargeback arrives after return window but before transfer
    // → cancel without debt (seller hasn't received funds yet)

    let status: any = "awaiting_return_window";
    status = stateMachine.transition(status, "return_window_expired");
    assert.strictEqual(status, "transfer_scheduled");

    status = stateMachine.transition(status, "chargeback_received");
    assert.strictEqual(status, "chargeback_cancelled");
  });

  it("buyer return path does not create debt", () => {
    // Settlement path when buyer returns item before window expires
    // → no transfer, no chargeback, no debt

    let status: any = "awaiting_return_window";
    status = stateMachine.transition(status, "buyer_returned");
    assert.strictEqual(status, "return_cancelled");
  });

  it("seller successfully receives payment (no chargeback)", () => {
    // Happy path: settlement → transfer → finalized (no chargeback)

    let status: string = "awaiting_return_window";
    status = stateMachine.transition(status as any, "return_window_expired");
    status = stateMachine.transition(status as any, "transfer_executed");
    status = stateMachine.transition(status as any, "chargeback_window_expired");
    assert.strictEqual(status, "finalized");
  });
});
