import { describe, it, expect } from "vitest";
import { formatOrderItemUnitPrice } from "./utils.js";

describe("order item unit price", () => {
  it.each([{ price: 10 }, { unit_price: 10 }, { unitPriceCents: 1000 }, { unit_price_cents: 1000 }])("renders R$ 10 from the documented unit in %j", item => {
    expect(formatOrderItemUnitPrice(item, "BRL")).toMatch(/10,00/);
    expect(formatOrderItemUnitPrice(item, "BRL")).not.toMatch(/0,10/);
  });
  it("keeps zero, fractional major units and explicit cents precedence", () => {
    expect(formatOrderItemUnitPrice({ price: 0 }, "BRL")).toMatch(/0,00/);
    expect(formatOrderItemUnitPrice({ price: 0.1 }, "BRL")).toMatch(/0,10/);
    expect(formatOrderItemUnitPrice({ unitPriceCents: 1000, price: 99 }, "BRL")).toMatch(/10,00/);
    expect(formatOrderItemUnitPrice({ price: 10, quantity: 3 }, "BRL")).toMatch(/10,00/);
  });
  it("uses unavailable for missing, malformed or unsafe prices", () => {
    for (const item of [null, {}, { price: "10" }, { price: NaN }, { price: -1 }, { price: Infinity }, { unitPriceCents: 10.5 }, { unitPriceCents: null, price: 10 }]) {
      expect(formatOrderItemUnitPrice(item, "BRL")).toBe("Valor indisponível");
    }
    expect(formatOrderItemUnitPrice({ price: 10 }, "invalid")).toBe("Valor indisponível");
  });
});
