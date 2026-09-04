import { describe, expect, it } from "vitest";
import {
  validateOriginZip,
  validateTreasuryAddress,
  validateNonNegative,
  validateMarginConsistency,
} from "./rules-validation.js";

describe("validateOriginZip", () => {
  it("returns null for valid CEP format", () => {
    expect(validateOriginZip("12345-678")).toBeNull();
  });

  it("returns error for invalid CEP format", () => {
    expect(validateOriginZip("1234-678")).toBe("CEP deve estar no formato 00000-000");
  });

  it("returns error for CEP without hyphen", () => {
    expect(validateOriginZip("12345678")).toBe("CEP deve estar no formato 00000-000");
  });

  it("returns null for empty string (optional field)", () => {
    expect(validateOriginZip("")).toBeNull();
  });

  it("returns null for undefined (optional field)", () => {
    expect(validateOriginZip(undefined)).toBeNull();
  });
});

describe("validateTreasuryAddress", () => {
  it("returns null for valid 0x address", () => {
    expect(validateTreasuryAddress("0x" + "a".repeat(40))).toBeNull();
  });

  it("returns null for valid mixed-case hex address", () => {
    expect(validateTreasuryAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0")).toBeNull();
  });

  it("returns error for short address", () => {
    expect(validateTreasuryAddress("0x123")).toBe(
      "Endereço deve iniciar com 0x seguido de 40 caracteres hexadecimais",
    );
  });

  it("returns error for address without 0x prefix", () => {
    expect(validateTreasuryAddress("a".repeat(40))).toBe(
      "Endereço deve iniciar com 0x seguido de 40 caracteres hexadecimais",
    );
  });

  it("returns null for empty string (optional when crypto disabled)", () => {
    expect(validateTreasuryAddress("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(validateTreasuryAddress(undefined)).toBeNull();
  });
});

describe("validateNonNegative", () => {
  it("returns error for negative value", () => {
    expect(validateNonNegative(-1)).toBe("Valor não pode ser negativo");
  });

  it("returns null for zero", () => {
    expect(validateNonNegative(0)).toBeNull();
  });

  it("returns null for positive value", () => {
    expect(validateNonNegative(100)).toBeNull();
  });
});

describe("validateMarginConsistency", () => {
  it("returns null when discount + margin <= 100", () => {
    expect(validateMarginConsistency(30, 40)).toBeNull();
  });

  it("returns null when discount + margin equals 100", () => {
    expect(validateMarginConsistency(60, 40)).toBeNull();
  });

  it("returns error when discount + margin exceeds 100", () => {
    expect(validateMarginConsistency(70, 40)).toBe(
      "Desconto máximo excede a margem mínima configurada",
    );
  });
});
