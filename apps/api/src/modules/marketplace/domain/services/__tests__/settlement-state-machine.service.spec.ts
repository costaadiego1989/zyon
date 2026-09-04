import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SettlementStateMachineService,
  type SettlementStatus,
  type SettlementEvent,
  type MarketplaceWindowConfig,
} from "../settlement-state-machine.service.js";

describe("SettlementStateMachineService", () => {
  const machine = new SettlementStateMachineService();

  describe("valid transitions", () => {
    const validCases: Array<{
      from: SettlementStatus;
      event: SettlementEvent;
      to: SettlementStatus;
    }> = [
      {
        from: "awaiting_return_window",
        event: "return_window_expired",
        to: "transfer_scheduled",
      },
      {
        from: "awaiting_return_window",
        event: "buyer_returned",
        to: "return_cancelled",
      },
      {
        from: "awaiting_return_window",
        event: "chargeback_received",
        to: "chargeback_cancelled",
      },
      {
        from: "transfer_scheduled",
        event: "transfer_executed",
        to: "transferred",
      },
      {
        from: "transfer_scheduled",
        event: "chargeback_received",
        to: "chargeback_cancelled",
      },
      {
        from: "transferred",
        event: "chargeback_window_expired",
        to: "finalized",
      },
      {
        from: "transferred",
        event: "chargeback_received",
        to: "chargeback_debt",
      },
    ];

    for (const { from, event, to } of validCases) {
      it(`${from} + ${event} → ${to}`, () => {
        const result = machine.transition(from, event);
        assert.equal(result, to);
      });
    }
  });

  describe("invalid transitions", () => {
    const invalidCases: Array<{
      from: SettlementStatus;
      event: SettlementEvent;
    }> = [
      { from: "awaiting_return_window", event: "transfer_executed" },
      { from: "awaiting_return_window", event: "chargeback_window_expired" },
      { from: "transfer_scheduled", event: "return_window_expired" },
      { from: "transfer_scheduled", event: "buyer_returned" },
      { from: "transferred", event: "return_window_expired" },
      { from: "transferred", event: "transfer_executed" },
      { from: "finalized", event: "chargeback_received" },
      { from: "finalized", event: "return_window_expired" },
      { from: "return_cancelled", event: "transfer_executed" },
      { from: "chargeback_cancelled", event: "chargeback_window_expired" },
      { from: "chargeback_debt", event: "transfer_executed" },
    ];

    for (const { from, event } of invalidCases) {
      it(`throws on ${from} + ${event}`, () => {
        assert.throws(() => machine.transition(from, event), {
          message: `Invalid transition: cannot apply event '${event}' to status '${from}'`,
        });
      });
    }
  });

  describe("calculateWindows", () => {
    it("calculates windows with standard config", () => {
      const config: MarketplaceWindowConfig = {
        returnWindowDays: 7,
        payoutDelayDays: 3,
        chargebackWindowDays: 14,
      };
      const orderDate = new Date("2026-08-01T00:00:00.000Z");

      const windows = machine.calculateWindows(config, orderDate);

      assert.equal(
        windows.returnWindowUntil.toISOString(),
        "2026-08-08T00:00:00.000Z"
      );
      assert.equal(
        windows.transferScheduledAt.toISOString(),
        "2026-08-11T00:00:00.000Z"
      );
      assert.equal(
        windows.chargebackWindowUntil.toISOString(),
        "2026-08-15T00:00:00.000Z"
      );
    });

    it("calculates windows with max config (30/30/30)", () => {
      const config: MarketplaceWindowConfig = {
        returnWindowDays: 30,
        payoutDelayDays: 30,
        chargebackWindowDays: 30,
      };
      const orderDate = new Date("2026-01-01T00:00:00.000Z");

      const windows = machine.calculateWindows(config, orderDate);

      assert.equal(
        windows.returnWindowUntil.toISOString(),
        "2026-01-31T00:00:00.000Z"
      );
      assert.equal(
        windows.transferScheduledAt.toISOString(),
        "2026-03-02T00:00:00.000Z"
      );
      assert.equal(
        windows.chargebackWindowUntil.toISOString(),
        "2026-01-31T00:00:00.000Z"
      );
    });

    it("calculates windows with min config (1/1/7)", () => {
      const config: MarketplaceWindowConfig = {
        returnWindowDays: 1,
        payoutDelayDays: 1,
        chargebackWindowDays: 7,
      };
      const orderDate = new Date("2026-08-18T12:00:00.000Z");

      const windows = machine.calculateWindows(config, orderDate);

      assert.equal(
        windows.returnWindowUntil.toISOString(),
        "2026-08-19T12:00:00.000Z"
      );
      assert.equal(
        windows.transferScheduledAt.toISOString(),
        "2026-08-20T12:00:00.000Z"
      );
      assert.equal(
        windows.chargebackWindowUntil.toISOString(),
        "2026-08-25T12:00:00.000Z"
      );
    });

    it("chargeback window independent of return + payout (can be shorter)", () => {
      const config: MarketplaceWindowConfig = {
        returnWindowDays: 14,
        payoutDelayDays: 7,
        chargebackWindowDays: 10,
      };
      const orderDate = new Date("2026-08-01T00:00:00.000Z");

      const windows = machine.calculateWindows(config, orderDate);

      // chargeback window ends Aug 11, return+payout ends Aug 22
      assert.equal(
        windows.chargebackWindowUntil.toISOString(),
        "2026-08-11T00:00:00.000Z"
      );
      assert.equal(
        windows.transferScheduledAt.toISOString(),
        "2026-08-22T00:00:00.000Z"
      );
    });
  });

  describe("validateConfig", () => {
    it("accepts valid config", () => {
      assert.doesNotThrow(() =>
        machine.validateConfig({
          returnWindowDays: 7,
          payoutDelayDays: 3,
          chargebackWindowDays: 14,
        })
      );
    });

    it("throws on returnWindowDays = 0", () => {
      assert.throws(
        () =>
          machine.validateConfig({
            returnWindowDays: 0,
            payoutDelayDays: 3,
            chargebackWindowDays: 14,
          }),
        { message: "returnWindowDays must be an integer between 1 and 30" }
      );
    });

    it("throws on returnWindowDays = 31", () => {
      assert.throws(
        () =>
          machine.validateConfig({
            returnWindowDays: 31,
            payoutDelayDays: 3,
            chargebackWindowDays: 14,
          }),
        { message: "returnWindowDays must be an integer between 1 and 30" }
      );
    });

    it("throws on payoutDelayDays = 0", () => {
      assert.throws(
        () =>
          machine.validateConfig({
            returnWindowDays: 7,
            payoutDelayDays: 0,
            chargebackWindowDays: 14,
          }),
        { message: "payoutDelayDays must be an integer between 1 and 30" }
      );
    });

    it("throws on payoutDelayDays = 31", () => {
      assert.throws(
        () =>
          machine.validateConfig({
            returnWindowDays: 7,
            payoutDelayDays: 31,
            chargebackWindowDays: 14,
          }),
        { message: "payoutDelayDays must be an integer between 1 and 30" }
      );
    });

    it("throws on chargebackWindowDays = 6", () => {
      assert.throws(
        () =>
          machine.validateConfig({
            returnWindowDays: 7,
            payoutDelayDays: 3,
            chargebackWindowDays: 6,
          }),
        {
          message:
            "chargebackWindowDays must be an integer between 7 and 30",
        }
      );
    });

    it("throws on chargebackWindowDays = 31", () => {
      assert.throws(
        () =>
          machine.validateConfig({
            returnWindowDays: 7,
            payoutDelayDays: 3,
            chargebackWindowDays: 31,
          }),
        {
          message:
            "chargebackWindowDays must be an integer between 7 and 30",
        }
      );
    });

    it("throws on non-integer returnWindowDays", () => {
      assert.throws(
        () =>
          machine.validateConfig({
            returnWindowDays: 7.5,
            payoutDelayDays: 3,
            chargebackWindowDays: 14,
          }),
        { message: "returnWindowDays must be an integer between 1 and 30" }
      );
    });
  });
});
