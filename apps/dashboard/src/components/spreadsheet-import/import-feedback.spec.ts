import { expect, it } from "vitest";
import { DashboardHttpError } from "../../api/http/error.js";
import { importErrorMessage, importUploadError, spreadsheetUploadMime } from "./import-feedback.js";

it("uses supported file extensions when the browser cannot identify the MIME", () => {
  expect(spreadsheetUploadMime("Produtos.CSV")).toBe("text/csv");
  expect(spreadsheetUploadMime("produtos.xlsx")).toContain("spreadsheetml.sheet");
  expect(spreadsheetUploadMime("produtos.xls")).toBeUndefined();
  expect(spreadsheetUploadMime("produtos.csv.exe")).toBeUndefined();
});
it("explains a known upload failure while preserving uncertain network results", () => {
  const error = new DashboardHttpError(503, JSON.stringify({ detail: "import_queue_unavailable" }));
  expect(importUploadError(error)).toContain("indisponível");
  expect(importUploadError(new Error("private provider diagnostic"))).toContain("Consulte o andamento");
  expect(importUploadError(new DashboardHttpError(500, "secret"))).not.toContain("secret");
});
it("renders stock and service errors without displaying machine codes", () => {
  expect(importErrorMessage("invalid_stock_quantity")).toContain("número inteiro");
  expect(importErrorMessage("stock_managed_by_erp")).toContain("controlado pelo ERP");
  expect(importErrorMessage("service_end_must_follow_start")).toContain("posterior ao início");
  expect(importErrorMessage("private raw diagnostic")).not.toContain("private");
});
