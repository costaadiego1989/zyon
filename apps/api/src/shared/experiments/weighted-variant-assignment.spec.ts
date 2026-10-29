import assert from "node:assert/strict";
import test from "node:test";
import { selectWeightedVariant } from "./weighted-variant-assignment.js";

const variants = [
  { id: "control", weight: 1 },
  { id: "treatment", weight: 1 },
];

test("stable weighted assignment reaches both equal-weight A/B arms", () => {
  const assigned = new Set(
    Array.from({ length: 256 }, (_, index) =>
      selectWeightedVariant(`checkout_${index}`, variants)?.id,
    ),
  );

  assert.deepEqual([...assigned].sort(), ["control", "treatment"]);
});

test("zero-weight variants are never selected", () => {
  const selected = selectWeightedVariant("checkout_zero_weight", [
    { id: "control", weight: 0 },
    { id: "treatment", weight: 100 },
  ]);
  assert.equal(selected?.id, "treatment");
});

test("a key with no positive variant receives no assignment", () => {
  assert.equal(selectWeightedVariant("checkout_none", [{ id: "a", weight: 0 }]), undefined);
});
