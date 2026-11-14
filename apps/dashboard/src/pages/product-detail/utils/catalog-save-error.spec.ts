import { expect, it } from "vitest";
import { DashboardHttpError } from "../../../api/http/error.js";
import { catalogSaveError } from "./catalog-save-error.js";

it("identifies a SKU conflict and keeps unrelated 409 errors distinct", () => {
  const duplicate = catalogSaveError(new DashboardHttpError(409, JSON.stringify({ message: "sku_already_exists:A,B" })));
  expect(duplicate.conflictingSkus).toEqual(["A", "B"]);
  expect(duplicate.message).toContain("SKU");
  expect(catalogSaveError(new DashboardHttpError(409, JSON.stringify({ message: "stock_quantity_below_reserved" })))).toEqual({ message: "O estoque não pode ser menor que a quantidade reservada.", conflictingSkus: [] });
});
it("does not expose raw server diagnostics", () => {
  const result = catalogSaveError(new DashboardHttpError(500, "private database detail"));
  expect(result.message).not.toContain("private"); expect(result.message).not.toContain("dashboard_http");
});
it("reads Problem Details responses used by the API", () => {
  const duplicate = catalogSaveError(new DashboardHttpError(409, JSON.stringify({ code: "sku_already_exists", detail: "sku_already_exists:A,B" })));
  expect(duplicate.conflictingSkus).toEqual(["A", "B"]);
  const managed = catalogSaveError(new DashboardHttpError(409, JSON.stringify({ code: "stock_managed_by_erp", detail: "stock_managed_by_erp" })));
  expect(managed.message).toContain("controlado pelo ERP");
});
