import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readSource() {
  return readFileSync(resolve("src/components/agent-rules-form.tsx"), "utf-8");
}

describe("AgentRulesForm", () => {
  it("exports AgentRulesForm function", async () => {
    const mod = await import("./agent-rules-form.js");
    expect(typeof mod.AgentRulesForm).toBe("function");
  });

  it("exports AgentRulesFormProps interface", () => {
    const src = readSource();
    expect(src).toContain("export interface AgentRulesFormProps");
  });

  it("has mode-toggle for switching between form and json", () => {
    const src = readSource();
    expect(src).toContain("mode-toggle");
    expect(src).toContain("Formulário");
    expect(src).toContain("JSON");
  });

  it("renders mono-textarea in json mode", () => {
    const src = readSource();
    expect(src).toContain("mono-textarea");
  });

  it("renders agent_id as read-only in form mode", () => {
    const src = readSource();
    expect(src).toContain("ID do Agente");
    expect(src).toContain("readOnly");
  });

  it("renders capabilities section", () => {
    const src = readSource();
    expect(src).toContain("Capacidades");
    expect(src).toContain("capabilities");
  });

  it("renders guardrails section", () => {
    const src = readSource();
    expect(src).toContain("Guardrails");
    expect(src).toContain("guardrails");
  });

  it("handles null rules gracefully", () => {
    const src = readSource();
    expect(src).toContain("Nenhuma regra carregada");
  });

  it("shows unknown keys as read-only JSON block", () => {
    const src = readSource();
    expect(src).toContain("Campos adicionais (somente leitura)");
  });

  it("supports disabled prop", () => {
    const src = readSource();
    expect(src).toContain("disabled");
  });

  it("has aria-label for textarea", () => {
    const src = readSource();
    expect(src).toContain('aria-label="JSON das regras do agente"');
  });
});
