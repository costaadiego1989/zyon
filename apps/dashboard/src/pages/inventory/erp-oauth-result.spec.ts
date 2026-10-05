import { describe, it, expect } from "vitest";
import { erpOAuthResult } from "./erp-oauth-result.js";

describe("ERP OAuth return", () => {
  it("explains Bling permissions instead of a generic retry", () => {
    const result = erpOAuthResult(new URLSearchParams("error=erp_permission_denied&erp_provider=bling"));
    expect(result?.kind).toBe("error");
    expect(result?.message).toContain("Bling recusou");
    expect(result?.message).toContain("administrador");
  });

  it("distinguishes refusal, disabled application and successful authorization", () => {
    expect(erpOAuthResult(new URLSearchParams("error=erp_denied&erp_provider=bling"))?.message).toContain("não foi concluída");
    expect(erpOAuthResult(new URLSearchParams("error=erp_app_inactive&erp_provider=bling"))?.message).toContain("suporte da Zyon");
    expect(erpOAuthResult(new URLSearchParams("erp_connected=bling"))).toEqual({ kind: "success", message: "Bling conectado com sucesso" });
  });

  it("ignores unrelated query errors and never displays raw provider text", () => {
    expect(erpOAuthResult(new URLSearchParams("error=other"))).toBeNull();
    expect(erpOAuthResult(new URLSearchParams("erp_connected=unknown"))).toBeNull();
    const result = erpOAuthResult(new URLSearchParams("error=erp_unknown&erp_provider=__proto__&error_description=private-token"));
    expect(result?.message).toBe("Não foi possível concluir a conexão com o ERP. Tente novamente.");
  });
});
