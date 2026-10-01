import { describe, it, expect } from "vitest";
import { erpOAuthHttpError, erpOAuthResult, erpSyncErrorMessage } from "./erp-oauth-result.js";

describe("ERP OAuth return", () => {
  it("shows actionable sync failures and never exposes internal provider text", () => {
    expect(erpSyncErrorMessage("erp_marketplace_duplicate_product_or_sku")).toContain("SKUs repetidos");
    expect(erpSyncErrorMessage("private-provider-secret")).not.toContain("private-provider-secret");
    expect(erpSyncErrorMessage("erp_multi_location_requires_mapping")).toContain("locais de estoque");
  });
  it("explains missing app configuration without rendering raw errors", () => {
    expect(erpOAuthHttpError("shopee", JSON.stringify({ code: "erp_provider_not_configured", detail: "secret" }))).toContain("ainda não foi configurada neste ambiente");
    expect(erpOAuthHttpError("tiktokshop", "private-token")).not.toContain("private-token");
  });

  it("does not claim the selected store was connected when OAuth started in another store", () => {
    const params = new URLSearchParams("erp_connected=mercadolivre&erp_merchant=child");
    expect(erpOAuthResult(params, "parent")?.kind).toBe("error");
    expect(erpOAuthResult(params, "parent")?.message).toContain("Selecione essa loja");
    expect(erpOAuthResult(params, "child")?.kind).toBe("success");
  });

  it("distinguishes external account ownership and multi-shop authorization", () => {
    expect(erpOAuthResult(new URLSearchParams("error=erp_marketplace_account_already_connected&erp_provider=shopee"))?.message).toContain("outra loja");
    expect(erpOAuthResult(new URLSearchParams("error=erp_shop_selection_required&erp_provider=tiktokshop"))?.message).toContain("várias lojas");
  });
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
