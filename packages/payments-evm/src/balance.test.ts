import { describe, it, expect } from "vitest";
import { formatBalance } from "./balance.js";
import { parseUnits } from "viem";

describe("formatBalance", () => {
  it("formats whole numbers without trailing zeros", () => {
    expect(formatBalance(parseUnits("5", 6), 6)).toBe("5");
    expect(formatBalance(parseUnits("100", 18), 18)).toBe("100");
  });

  it("trims trailing zeros from the fractional part", () => {
    expect(formatBalance(parseUnits("1.250000", 6), 6)).toBe("1.25");
    expect(formatBalance(parseUnits("0.10000", 6), 6)).toBe("0.1");
  });

  it("respects displayDecimals", () => {
    expect(formatBalance(parseUnits("1.234567", 6), 6, 2)).toBe("1.23");
    expect(formatBalance(parseUnits("1.234567", 6), 6, 0)).toBe("1");
  });

  it("rejects negative decimals", () => {
    expect(() => formatBalance(1n, -1)).toThrow(/invalid_decimals/);
  });
});