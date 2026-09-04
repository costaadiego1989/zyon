import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readSource() {
  return readFileSync(resolve("src/pages/merchant-rules-page.tsx"), "utf-8");
}

describe("MerchantRulesAuthenticatedPage", () => {
  it("exports the page component", async () => {
    const mod = await import("./merchant-rules-page.js");
    expect(mod.MerchantRulesAuthenticatedPage).toBeDefined();
    expect(typeof mod.MerchantRulesAuthenticatedPage).toBe("function");
  });

  it("does not contain invalida or invalido without accent", () => {
    const src = readSource();
    expect(src).not.toMatch(/invalida[^á]/);
    expect(src).not.toMatch(/invalido[^á]/);
    expect(src).not.toContain('"invalida');
    expect(src).not.toContain('"invalido');
  });

  it("uses correct page header", () => {
    const src = readSource();
    expect(src).toContain("Regras do Agente");
    expect(src).not.toContain("Regras do merchant atual");
  });

  it("does not expose internal route paths in header", () => {
    const src = readSource();
    expect(src).not.toMatch(/page-lead.*\/merchants\/me\/rules/);
  });

  it("uses className-based layout for primary page structure", () => {
    const src = readSource();
    // Verify CSS-class approach for main layout elements
    expect(src).toContain('className="page-head"');
    expect(src).toContain('className="page-lead"');
  });

  it("uses descriptive subtitle with agent behavior", () => {
    const src = readSource();
    expect(src).toContain("Defina o comportamento e os limites do agente de checkout");
  });

  it("tracks dirty state with deepEqual and lastSavedRules", () => {
    const src = readSource();
    expect(src).toContain("deepEqual");
    expect(src).toContain("lastSavedRules");
    expect(src).toContain("isDirty");
  });

  it("disables save button when not dirty or has errors", () => {
    const src = readSource();
    expect(src).toContain("!isDirty");
    expect(src).toContain("hasValidationErrors");
  });

  it("shows unsaved changes badge when dirty", () => {
    const src = readSource();
    expect(src).toContain("badge-unsaved");
    expect(src).toContain("Alterações não salvas");
  });

  it("save button has tooltip when validation errors exist", () => {
    const src = readSource();
    expect(src).toContain("Corrija os erros antes de salvar");
  });

  it("includes SaveFeedbackBanner with aria-live region", () => {
    const src = readSource();
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain("SaveFeedbackBanner");
  });

  it("401 state has re-login button with correct text", () => {
    const src = readSource();
    expect(src).toContain("Sessão inválida ou expirada");
    expect(src).toContain("Fazer login novamente");
    expect(src).toContain('role="alert"');
  });

  it("error state has retry button", () => {
    const src = readSource();
    expect(src).toContain("Tentar novamente");
    expect(src).toContain("fetchRules");
  });

  it("uses RulesSkeleton instead of loading text", () => {
    const src = readSource();
    expect(src).toContain("RulesSkeleton");
    expect(src).not.toContain("Carregando regras...");
  });

  it("uses AgentRulesForm with mode toggle instead of raw textarea", () => {
    const src = readSource();
    expect(src).toContain("AgentRulesForm");
    expect(src).toContain("agentRulesMode");
    expect(src).toContain("setAgentRulesMode");
  });

  it("includes validation integration", () => {
    const src = readSource();
    expect(src).toContain("validateOriginZip");
    expect(src).toContain("validateTreasuryAddress");
    expect(src).toContain("validateNonNegative");
    expect(src).toContain("validateMarginConsistency");
    expect(src).toContain("validationErrors");
  });

  it("updates lastSavedRules on successful save", () => {
    const src = readSource();
    expect(src).toContain("setLastSavedRules(saved)");
  });

  it("sets saveResult on save success and error", () => {
    const src = readSource();
    expect(src).toContain('setSaveResult("success")');
    expect(src).toContain('setSaveResult("error")');
  });

  it("agent rules save uses correct accent in error message", () => {
    const src = readSource();
    expect(src).toContain("JSON inválido:");
    expect(src).not.toContain("JSON invalido:");
  });
});
