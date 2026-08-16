import { describe, it, expect } from "vitest";
import { centsToReais, reaisToCents, formatCurrencyInput, applyCurrencyMask } from "../utils/currency.js";

describe("centsToReais", () => {
  it("formats 15090 cents as 150,90", () => {
    expect(centsToReais(15090)).toBe("150,90");
  });

  it("formats 150000 cents as 1.500,00 (pt-BR milhar)", () => {
    expect(centsToReais(150000)).toBe("1.500,00");
  });

  it("formats 100 cents as 1,00", () => {
    expect(centsToReais(100)).toBe("1,00");
  });

  it("formats 8990 cents as 89,90", () => {
    expect(centsToReais(8990)).toBe("89,90");
  });

  it("formats 0 cents as 0,00", () => {
    expect(centsToReais(0)).toBe("0,00");
  });

  it("formats 259000 cents as 2.590,00", () => {
    expect(centsToReais(259000)).toBe("2.590,00");
  });
});

describe("reaisToCents", () => {
  it("parses 150,90 → 15090", () => {
    expect(reaisToCents("150,90")).toBe(15090);
  });

  it("parses 25,90 → 2590", () => {
    expect(reaisToCents("25,90")).toBe(2590);
  });

  it("parses 89,90 → 8990", () => {
    expect(reaisToCents("89,90")).toBe(8990);
  });

  it("parses 1500 (no decimal) → 150000", () => {
    expect(reaisToCents("1500")).toBe(150000);
  });

  it("parses 1.500,00 (milhar + decimal) → 150000", () => {
    expect(reaisToCents("1.500,00")).toBe(150000);
  });

  it("parses 2.590,00 → 259000 (idempotent with centsToReais output)", () => {
    expect(reaisToCents("2.590,00")).toBe(259000);
  });

  it("parses 25,90 → 2590 → centsToReais → 25,90 (round-trip)", () => {
    const cents = reaisToCents("25,90");
    expect(cents).toBe(2590);
    expect(centsToReais(cents)).toBe("25,90");
  });

  it("parses 89.90 (dot decimal, no comma) → 8990", () => {
    expect(reaisToCents("89.90")).toBe(8990);
  });

  it("handles empty string → 0", () => {
    expect(reaisToCents("")).toBe(0);
  });

  it("handles garbage → 0", () => {
    expect(reaisToCents("abc")).toBe(0);
  });
});

describe("formatCurrencyInput (onBlur)", () => {
  it("25,90 stays 25,90", () => {
    expect(formatCurrencyInput("25,90")).toBe("25,90");
  });

  it("150,90 stays 150,90", () => {
    expect(formatCurrencyInput("150,90")).toBe("150,90");
  });

  it("1500 becomes 1.500,00 (pt-BR format)", () => {
    expect(formatCurrencyInput("1500")).toBe("1.500,00");
  });

  it("1.500,00 stays 1.500,00 (idempotent)", () => {
    expect(formatCurrencyInput("1.500,00")).toBe("1.500,00");
  });

  it("2.590,00 stays 2.590,00 (idempotent)", () => {
    expect(formatCurrencyInput("2.590,00")).toBe("2.590,00");
  });

  it("empty stays empty", () => {
    expect(formatCurrencyInput("")).toBe("");
  });

  it("15,9 becomes 15,90", () => {
    expect(formatCurrencyInput("15,9")).toBe("15,90");
  });
});

describe("applyCurrencyMask (live typing)", () => {
  it("'2590' → '25,90'", () => {
    expect(applyCurrencyMask("2590")).toBe("25,90");
  });

  it("'150000' → '1.500,00'", () => {
    expect(applyCurrencyMask("150000")).toBe("1.500,00");
  });

  it("'8990' → '89,90'", () => {
    expect(applyCurrencyMask("8990")).toBe("89,90");
  });

  it("'1' → '0,01'", () => {
    expect(applyCurrencyMask("1")).toBe("0,01");
  });

  it("'25' → '0,25'", () => {
    expect(applyCurrencyMask("25")).toBe("0,25");
  });

  it("empty → ''", () => {
    expect(applyCurrencyMask("")).toBe("");
  });

  it("strips non-digits: '25,90' → treats as '2590' → '25,90'", () => {
    expect(applyCurrencyMask("25,90")).toBe("25,90");
  });
});
