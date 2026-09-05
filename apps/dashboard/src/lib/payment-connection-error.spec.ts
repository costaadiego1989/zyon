import { describe, it, expect } from "vitest";
import { DashboardHttpError } from "../api/http/error.js";
import { paymentConnectionError } from "./payment-connection-error.js";

describe("Asaas connection errors", () => {
  it("shows the specific provider rejection", () => {
    const error = new DashboardHttpError(502, JSON.stringify({ code: "asaas_platform_failed", detail: "asaas: Cadastro já existente. (invalid_object)" }));
    expect(paymentConnectionError(error)).toBe("Asaas: Cadastro já existente. (invalid_object)");
  });
  it("keeps a useful fallback for unavailable or malformed provider responses", () => {
    expect(paymentConnectionError(new DashboardHttpError(502, JSON.stringify({ code: "asaas_platform_failed", detail: "<html>private debug</html>" })))).toContain("O Asaas não concluiu");
    expect(paymentConnectionError(new DashboardHttpError(502, "not json"))).toBeUndefined();
  });
  it("explains environment mismatch", () => {
    expect(paymentConnectionError(new DashboardHttpError(400, JSON.stringify({ code: "asaas_environment_mismatch" })))).toContain("ambiente selecionado");
  });
});
