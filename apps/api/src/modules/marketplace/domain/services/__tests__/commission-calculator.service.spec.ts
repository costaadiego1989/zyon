import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CommissionCalculatorService,
  type CommissionInput,
} from "../commission-calculator.service.js";

describe("CommissionCalculatorService", () => {
  const calculator = new CommissionCalculatorService();

  describe("valid calculations", () => {
    it("standard: R$100, qty 1, 15% → commission R$15, seller R$85", () => {
      const input: CommissionInput = {
        itemPriceCents: 10000,
        quantity: 1,
        commissionRateBps: 1500,
      };

      const result = calculator.calculate(input);

      assert.equal(result.totalCents, 10000);
      assert.equal(result.commissionCents, 1500);
      assert.equal(result.sellerNetCents, 8500);
    });

    it("rounding: R$33.33, qty 1, 15% → commission 500 (ceil), seller 2833", () => {
      const input: CommissionInput = {
        itemPriceCents: 3333,
        quantity: 1,
        commissionRateBps: 1500,
      };

      const result = calculator.calculate(input);

      // 3333 * 1500 / 10000 = 499.95 → ceil = 500
      assert.equal(result.totalCents, 3333);
      assert.equal(result.commissionCents, 500);
      assert.equal(result.sellerNetCents, 2833);
    });

    it("edge: commission 100 bps (1%) on R$1 → commission 1 cent, seller 99 cents", () => {
      const input: CommissionInput = {
        itemPriceCents: 100,
        quantity: 1,
        commissionRateBps: 100,
      };

      const result = calculator.calculate(input);

      // 100 * 100 / 10000 = 1.0 → ceil = 1
      assert.equal(result.totalCents, 100);
      assert.equal(result.commissionCents, 1);
      assert.equal(result.sellerNetCents, 99);
    });

    it("edge: commission 5000 bps (50%) on R$200 → commission R$100, seller R$100", () => {
      const input: CommissionInput = {
        itemPriceCents: 20000,
        quantity: 1,
        commissionRateBps: 5000,
      };

      const result = calculator.calculate(input);

      assert.equal(result.totalCents, 20000);
      assert.equal(result.commissionCents, 10000);
      assert.equal(result.sellerNetCents, 10000);
    });

    it("large qty: R$50, qty 100, 10% → total 500000, commission 50000, seller 450000", () => {
      const input: CommissionInput = {
        itemPriceCents: 5000,
        quantity: 100,
        commissionRateBps: 1000,
      };

      const result = calculator.calculate(input);

      assert.equal(result.totalCents, 500000);
      assert.equal(result.commissionCents, 50000);
      assert.equal(result.sellerNetCents, 450000);
    });

    it("ceil ensures host gets at least 1 cent on tiny amounts", () => {
      const input: CommissionInput = {
        itemPriceCents: 1,
        quantity: 1,
        commissionRateBps: 100,
      };

      const result = calculator.calculate(input);

      // 1 * 100 / 10000 = 0.01 → ceil = 1
      assert.equal(result.totalCents, 1);
      assert.equal(result.commissionCents, 1);
      assert.equal(result.sellerNetCents, 0);
    });

    it("totalCents = commissionCents + sellerNetCents invariant holds", () => {
      const cases: CommissionInput[] = [
        { itemPriceCents: 9999, quantity: 3, commissionRateBps: 1234 },
        { itemPriceCents: 1, quantity: 1, commissionRateBps: 5000 },
        { itemPriceCents: 50000, quantity: 50, commissionRateBps: 100 },
        { itemPriceCents: 777, quantity: 7, commissionRateBps: 3333 },
      ];

      for (const input of cases) {
        const result = calculator.calculate(input);
        assert.equal(
          result.totalCents,
          result.commissionCents + result.sellerNetCents,
          `Invariant failed for input: ${JSON.stringify(input)}`
        );
      }
    });
  });

  describe("validation", () => {
    it("throws on quantity 0", () => {
      assert.throws(
        () =>
          calculator.calculate({
            itemPriceCents: 10000,
            quantity: 0,
            commissionRateBps: 1000,
          }),
        { message: "quantity must be a positive integer" }
      );
    });

    it("throws on negative quantity", () => {
      assert.throws(
        () =>
          calculator.calculate({
            itemPriceCents: 10000,
            quantity: -1,
            commissionRateBps: 1000,
          }),
        { message: "quantity must be a positive integer" }
      );
    });

    it("throws on itemPriceCents 0", () => {
      assert.throws(
        () =>
          calculator.calculate({
            itemPriceCents: 0,
            quantity: 1,
            commissionRateBps: 1000,
          }),
        { message: "itemPriceCents must be a positive integer" }
      );
    });

    it("throws on negative itemPriceCents", () => {
      assert.throws(
        () =>
          calculator.calculate({
            itemPriceCents: -100,
            quantity: 1,
            commissionRateBps: 1000,
          }),
        { message: "itemPriceCents must be a positive integer" }
      );
    });

    it("throws on non-integer itemPriceCents", () => {
      assert.throws(
        () =>
          calculator.calculate({
            itemPriceCents: 99.5,
            quantity: 1,
            commissionRateBps: 1000,
          }),
        { message: "itemPriceCents must be a positive integer" }
      );
    });

    it("throws on commissionRateBps below 100", () => {
      assert.throws(
        () =>
          calculator.calculate({
            itemPriceCents: 10000,
            quantity: 1,
            commissionRateBps: 99,
          }),
        { message: "commissionRateBps must be an integer between 100 and 5000" }
      );
    });

    it("throws on commissionRateBps above 5000", () => {
      assert.throws(
        () =>
          calculator.calculate({
            itemPriceCents: 10000,
            quantity: 1,
            commissionRateBps: 5001,
          }),
        { message: "commissionRateBps must be an integer between 100 and 5000" }
      );
    });

    it("throws on non-integer commissionRateBps", () => {
      assert.throws(
        () =>
          calculator.calculate({
            itemPriceCents: 10000,
            quantity: 1,
            commissionRateBps: 1500.5,
          }),
        { message: "commissionRateBps must be an integer between 100 and 5000" }
      );
    });
  });
});
