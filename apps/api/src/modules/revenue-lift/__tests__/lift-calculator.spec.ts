import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RevenueLiftCalculatorService,
  type LiftCalculationInput,
} from "../domain/services/revenue-lift-calculator.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string) {
  // Try dist first, then fallback to src
  let path = join(__dirname, "..", "__fixtures__", name);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    // Fallback to src directory (from dist/modules/revenue-lift/__tests__ → ../../../../src/modules/revenue-lift/__fixtures__)
    path = join(__dirname, "..", "..", "..", "..", "src", "modules", "revenue-lift", "__fixtures__", name);
    return JSON.parse(readFileSync(path, "utf-8"));
  }
}

function closeToOrNull(actual: number | null, expected: number | null, tolerance: number = 1e-6): boolean {
  if (actual === null && expected === null) return true;
  if (actual === null || expected === null) return false;
  return Math.abs(actual - expected) <= tolerance;
}

test("RevenueLiftCalculatorService — lift formula correctness", async (t) => {
  const calc = new RevenueLiftCalculatorService();

  await t.test("L1-L4: golden dataset — all 5 cases pass exact math", () => {
    const fixture = loadFixture("golden-lift-dataset.json");
    for (const dataset of fixture.datasets) {
      const result = calc.calculate({
        holdout: dataset.holdout,
        treatment: dataset.treatment,
        aiCostsTotalCents: dataset.aiCostsTotalCents,
      });

      // Check each field with appropriate precision
      if (dataset.expected.holdoutAvgRevenueCents === null) {
        assert.strictEqual(result.holdoutAvgRevenueCents, null, `${dataset.name}: holdoutAvg should be null`);
      } else {
        assert.ok(
          closeToOrNull(result.holdoutAvgRevenueCents, dataset.expected.holdoutAvgRevenueCents, 1),
          `${dataset.name}: holdoutAvg mismatch (got ${result.holdoutAvgRevenueCents}, expected ${dataset.expected.holdoutAvgRevenueCents})`,
        );
      }

      if (dataset.expected.treatmentAvgRevenueCents === null) {
        assert.strictEqual(result.treatmentAvgRevenueCents, null, `${dataset.name}: treatmentAvg should be null`);
      } else {
        assert.ok(
          closeToOrNull(result.treatmentAvgRevenueCents, dataset.expected.treatmentAvgRevenueCents, 1),
          `${dataset.name}: treatmentAvg mismatch (got ${result.treatmentAvgRevenueCents}, expected ${dataset.expected.treatmentAvgRevenueCents})`,
        );
      }

      if (dataset.expected.grossLiftPercent === null) {
        assert.strictEqual(result.grossLiftPercent, null, `${dataset.name}: grossLift should be null`);
      } else {
        assert.ok(
          closeToOrNull(result.grossLiftPercent, dataset.expected.grossLiftPercent, 0.01),
          `${dataset.name}: grossLift mismatch (got ${result.grossLiftPercent}, expected ${dataset.expected.grossLiftPercent})`,
        );
      }

      if (dataset.expected.holdoutProjectedCents === null) {
        assert.strictEqual(result.holdoutProjectedCents, null, `${dataset.name}: projected should be null`);
      } else {
        assert.ok(
          closeToOrNull(result.holdoutProjectedCents, dataset.expected.holdoutProjectedCents, 1),
          `${dataset.name}: projected mismatch (got ${result.holdoutProjectedCents}, expected ${dataset.expected.holdoutProjectedCents})`,
        );
      }

      if (dataset.expected.netLiftCents === null) {
        assert.strictEqual(result.netLiftCents, null, `${dataset.name}: netLift should be null`);
      } else {
        assert.ok(
          closeToOrNull(result.netLiftCents, dataset.expected.netLiftCents, 1),
          `${dataset.name}: netLift mismatch (got ${result.netLiftCents}, expected ${dataset.expected.netLiftCents})`,
        );
      }

      if (dataset.expected.roiPercent === null) {
        assert.strictEqual(result.roiPercent, null, `${dataset.name}: roi should be null`);
      } else {
        assert.ok(
          closeToOrNull(result.roiPercent, dataset.expected.roiPercent, 1),
          `${dataset.name}: roi mismatch (got ${result.roiPercent}, expected ${dataset.expected.roiPercent})`,
        );
      }
    }
  });

  await t.test("L2: holdout_projected = holdout_avg × treatment_sessions (NOT subtraction)", () => {
    // Bug regression: developer might "simplify" to (treatment_total - holdout_total).
    // This test pins the multiplication semantics.
    const result = calc.calculate({
      holdout: { sessions: 100, orders: 10, totalRevenueCents: 100000 },
      treatment: { sessions: 1900, orders: 190, totalRevenueCents: 1900000 },
      aiCostsTotalCents: 0,
    });

    const holdoutAvg = 100000 / 100; // 1000
    const expectedProjected = holdoutAvg * 1900; // 1900000
    assert.equal(
      result.holdoutProjectedCents,
      expectedProjected,
      `holdout_projected must be holdout_avg × treatment_sessions, not subtraction`,
    );
  });

  await t.test("L5: holdout_sessions = 0 → ALL fields null (NOT Infinity/NaN)", () => {
    const result = calc.calculate({
      holdout: { sessions: 0, orders: 0, totalRevenueCents: 0 },
      treatment: { sessions: 1000, orders: 50, totalRevenueCents: 1000000 },
      aiCostsTotalCents: 1000,
    });

    assert.strictEqual(result.holdoutAvgRevenueCents, null);
    assert.strictEqual(result.treatmentAvgRevenueCents, null);
    assert.strictEqual(result.grossLiftPercent, null);
    assert.strictEqual(result.netLiftCents, null);
    assert.strictEqual(result.roiPercent, null);

    // Verify no Infinity or NaN slipped through
    assert.ok(!Number.isFinite(result.grossLiftPercent ?? Infinity), "grossLift should not be finite");
    assert.ok(!Number.isFinite(result.netLiftCents ?? Infinity), "netLift should not be finite");
  });

  await t.test("L6: negative lift (treatment worse) → negative number, NOT clamped to 0", () => {
    const result = calc.calculate({
      holdout: { sessions: 1000, orders: 100, totalRevenueCents: 2000000 },
      treatment: { sessions: 19000, orders: 950, totalRevenueCents: 1700000 },
      aiCostsTotalCents: 0,
    });

    assert.ok(
      (result.grossLiftPercent ?? 0) < 0,
      `Negative treatment must produce negative grossLift, got ${result.grossLiftPercent}`,
    );
    assert.ok(
      (result.netLiftCents ?? 0) < 0,
      `Negative treatment must produce negative netLift, got ${result.netLiftCents}`,
    );
  });

  await t.test("L4: ai_costs_total = 0 → roi = null (division by zero guard); gross/net still computed", () => {
    const result = calc.calculate({
      holdout: { sessions: 100, orders: 10, totalRevenueCents: 100000 },
      treatment: { sessions: 1900, orders: 190, totalRevenueCents: 1900000 },
      aiCostsTotalCents: 0,
    });

    assert.strictEqual(
      result.roiPercent,
      null,
      "ROI must be null when ai_costs=0 (divide by zero guard)",
    );
    // But gross and net must still be valid
    assert.ok(result.grossLiftPercent !== null, "grossLift should be computed even when roi=null");
    assert.ok(result.netLiftCents !== null, "netLift should be computed even when roi=null");
  });

  await t.test("edge: holdout_orders = 0 (but sessions > 0) → null", () => {
    const result = calc.calculate({
      holdout: { sessions: 100, orders: 0, totalRevenueCents: 0 },
      treatment: { sessions: 1900, orders: 190, totalRevenueCents: 1900000 },
      aiCostsTotalCents: 1000,
    });

    assert.strictEqual(result.grossLiftPercent, null);
    assert.strictEqual(result.roiPercent, null);
  });

  await t.test("formula consistency: always holdout_avg, treatment_avg, not total-based", () => {
    // Test that the formula uses per-session averages consistently
    const result = calc.calculate({
      holdout: { sessions: 50, orders: 5, totalRevenueCents: 5000 }, // avg = 100
      treatment: { sessions: 100, orders: 10, totalRevenueCents: 15000 }, // avg = 150
      aiCostsTotalCents: 0,
    });

    // gross_lift should be (150-100)/100*100 = 50%
    assert.ok(
      closeToOrNull(result.grossLiftPercent, 50, 0.1),
      `Formula must use per-session averages; got ${result.grossLiftPercent}%`,
    );
  });
});
