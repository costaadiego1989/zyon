import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readSource() {
  return readFileSync(resolve("src/components/rules-skeleton.tsx"), "utf-8");
}

describe("RulesSkeleton", () => {
  it("exports RulesSkeleton function", async () => {
    const mod = await import("./rules-skeleton.js");
    expect(typeof mod.RulesSkeleton).toBe("function");
  });

  it("has aria-busy true attribute", () => {
    const src = readSource();
    expect(src).toContain('aria-busy="true"');
  });

  it("has aria-label for loading state in Portuguese", () => {
    const src = readSource();
    expect(src).toContain('aria-label="Carregando configurações"');
  });

  it("uses split-panel class for layout", () => {
    const src = readSource();
    expect(src).toContain("split-panel");
  });

  it("renders skeleton-block elements", () => {
    const src = readSource();
    expect(src).toContain("skeleton-block");
  });

  it("uses split-panel-controls and split-panel-preview", () => {
    const src = readSource();
    expect(src).toContain("split-panel-controls");
    expect(src).toContain("split-panel-preview");
  });

  it("accepts optional className prop", () => {
    const src = readSource();
    expect(src).toContain("className");
  });
});
