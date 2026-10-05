import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CouponsPage } from "./CouponsPage.js";

vi.mock("./useCouponsPage.js", () => ({ useCouponsPage: () => ({
  coupons: [
    { id: "strategy-coupon", code: "ZYON0123456789ABCDEF0123", discountType: "fixed", discountValue: 10,
      usedCount: 2, maxUses: 30, isActive: true, strategyIncentiveExecutionId: "execution-1" },
    { id: "manual-coupon", code: "MANUAL10", discountType: "percent", discountValue: 10, usedCount: 0, isActive: true },
  ], loading: false, loadError: null, showForm: false, form: {}, fieldErrors: {}, validationAttempt: 0,
}) }));

describe("strategy coupon management", () => {
  it("routes managed coupon actions to AI review while retaining manual coupon controls", () => {
    const html = renderToStaticMarkup(<CouponsPage apiBaseUrl="https://api.test" me={null} />);
    expect(html).toContain("Gerenciado pela estratégia de IA");
    expect(html).toContain("href=\"#revenue-manager\"");
    expect(html).toContain("O código não libera o benefício para outros compradores");
    expect(html).toContain("Consulte os resultados da estratégia");
    expect(html).not.toContain("Pausar cupom ZYON0123456789ABCDEF0123");
    expect(html).not.toContain("Arquivar cupom ZYON0123456789ABCDEF0123");
    expect(html).toContain("Pausar cupom MANUAL10");
    expect(html).toContain("Arquivar cupom MANUAL10");
  });
});
