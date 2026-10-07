import { describe, expect, it } from "vitest";
import { formatMovementQuantity, inventoryAdjustment } from "./inventory-display.js";

describe("inventory signed quantities", () => {
  it("renders signed adjustments without a second minus and legacy exits as negative", () => {
    expect(formatMovementQuantity("ADJUSTMENT", -2)).toBe("−2");
    expect(formatMovementQuantity("ADJUSTMENT", 2)).toBe("+2");
    expect(formatMovementQuantity("EXIT", 2)).toBe("−2");
    expect(formatMovementQuantity("ENTRY", 2)).toBe("+2");
  });
  it("accepts only explicit nonzero integer deltas instead of truncating decimals", () => {
    expect(inventoryAdjustment(" -2 ")).toBe(-2); expect(inventoryAdjustment("+3")).toBe(3);
    for (const value of ["1.5", "2units", "", "0", "2147483648"]) expect(inventoryAdjustment(value)).toBeNull();
  });
});
