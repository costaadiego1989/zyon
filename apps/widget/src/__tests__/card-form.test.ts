import { describe, it, expect } from "vitest";
import { detectBrand, luhnCheck, validateExpiry } from "../components/checkout/CardForm.js";

describe("detectBrand", () => {
  it("detects Visa", () => {
    expect(detectBrand("4111111111111111")).toBe("visa");
    expect(detectBrand("4000000000000000")).toBe("visa");
  });

  it("detects Mastercard (5-series)", () => {
    expect(detectBrand("5500000000000004")).toBe("mastercard");
    expect(detectBrand("5100000000000007")).toBe("mastercard");
  });

  it("detects Mastercard (2-series)", () => {
    expect(detectBrand("2221000000000009")).toBe("mastercard");
    expect(detectBrand("2720000000000000")).toBe("mastercard");
  });

  it("detects Amex", () => {
    expect(detectBrand("371449635398431")).toBe("amex");
    expect(detectBrand("340000000000009")).toBe("amex");
  });

  it("detects Elo", () => {
    expect(detectBrand("6501050000000000")).toBe("elo");
    expect(detectBrand("5067040000000000")).toBe("elo");
  });

  it("returns unknown for unrecognized prefix", () => {
    expect(detectBrand("9999")).toBe("unknown");
    expect(detectBrand("")).toBe("unknown");
  });
});

describe("luhnCheck", () => {
  it("passes valid Visa test number", () => {
    expect(luhnCheck("4111111111111111")).toBe(true);
  });

  it("passes valid Mastercard test number", () => {
    expect(luhnCheck("5500000000000004")).toBe(true);
  });

  it("passes valid Amex test number", () => {
    expect(luhnCheck("371449635398431")).toBe(true);
  });

  it("fails invalid number", () => {
    expect(luhnCheck("4111111111111112")).toBe(false);
    expect(luhnCheck("1234567890123456")).toBe(false);
  });

  it("fails numbers shorter than 13 digits", () => {
    expect(luhnCheck("41111111")).toBe(false);
  });

  it("ignores non-digit characters", () => {
    expect(luhnCheck("4111 1111 1111 1111")).toBe(true);
  });
});

describe("validateExpiry", () => {
  it("accepts valid future date", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const mm = String(future.getMonth() + 1).padStart(2, "0");
    const yy = String(future.getFullYear()).slice(2);
    expect(validateExpiry(`${mm}/${yy}`)).toBe(true);
  });

  it("accepts current month", () => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(2);
    expect(validateExpiry(`${mm}/${yy}`)).toBe(true);
  });

  it("rejects past date", () => {
    expect(validateExpiry("01/20")).toBe(false);
    expect(validateExpiry("12/22")).toBe(false);
  });

  it("rejects invalid month", () => {
    expect(validateExpiry("00/30")).toBe(false);
    expect(validateExpiry("13/30")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(validateExpiry("1230")).toBe(false);
    expect(validateExpiry("12-30")).toBe(false);
    expect(validateExpiry("")).toBe(false);
  });
});
