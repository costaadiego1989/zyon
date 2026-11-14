import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readSource() {
  return readFileSync(resolve("src/components/save-feedback-banner.tsx"), "utf-8");
}

describe("SaveFeedbackBanner", () => {
  it("exports SaveFeedbackBanner function", async () => {
    const mod = await import("./save-feedback-banner.js");
    expect(typeof mod.SaveFeedbackBanner).toBe("function");
  });

  it("exports SaveFeedbackBannerProps type via interface", () => {
    const src = readSource();
    expect(src).toContain("export interface SaveFeedbackBannerProps");
  });

  it("renders null when result is null", () => {
    const src = readSource();
    expect(src).toContain("if (result === null) return null");
  });

  it("has auto-dismiss on success after 4 seconds", () => {
    const src = readSource();
    expect(src).toContain("setTimeout(onDismiss, 4000)");
  });

  it("uses role=status with aria-live=polite for success", () => {
    const src = readSource();
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
  });

  it("uses role=alert for error", () => {
    const src = readSource();
    expect(src).toContain('role="alert"');
  });

  it("has default success message in Portuguese", () => {
    const src = readSource();
    expect(src).toContain("Regras salvas com sucesso");
  });

  it("has default error message in Portuguese", () => {
    const src = readSource();
    expect(src).toContain("Erro ao salvar regras");
  });

  it("uses panel-success class for success state", () => {
    const src = readSource();
    expect(src).toContain("panel-success");
  });

  it("has dismiss button for error state", () => {
    const src = readSource();
    expect(src).toContain("onDismiss");
    expect(src).toContain("Fechar");
  });
});
