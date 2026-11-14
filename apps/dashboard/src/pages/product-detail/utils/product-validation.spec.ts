import { expect, it } from "vitest";
import { parseInteger, validateProductMetadata, validateSimpleProduct } from "./product-validation.js";
import { emptyVariant } from "../hooks/useVariantManager.js";

it("rejects partial integers and invalid physical weight", () => {
  expect(parseInteger("2.5")).toBeNull(); expect(parseInteger("2abc")).toBeNull(); expect(parseInteger("0")).toBe(0);
  expect(validateSimpleProduct({ ...emptyVariant(), sku: "SKU", basePriceInput: "10,00", weightInput: "0", stockInput: "2.5" }, "physical")).toMatchObject({ simple_weight: "Peso inválido", simple_stock: "Estoque deve ser um inteiro maior ou igual a zero" });
});
it("validates complete and ordered service intervals", () => {
  const interval = { startDate: "2026-10-02", startTime: "10:00", endDate: "2026-10-02", endTime: "11:00" };
  expect(validateProductMetadata("service", interval)).toEqual({});
  expect(validateProductMetadata("service", { ...interval, endTime: "09:00" }).serviceInterval).toBeTruthy();
  expect(validateProductMetadata("service", { ...interval, endTime: "" }).serviceInterval).toBeTruthy();
  expect(validateProductMetadata("service", { ...interval, endDate: "2026-02-30" }).serviceInterval).toBeTruthy();
});
it("accepts HTTPS downloads and rejects invalid URLs", () => {
  expect(validateProductMetadata("digital", { downloadUrl: "https://example.com/file.pdf" })).toEqual({});
  expect(validateProductMetadata("digital", { downloadUrl: "http://example.com/file.pdf" }).downloadUrl).toBeTruthy();
});
