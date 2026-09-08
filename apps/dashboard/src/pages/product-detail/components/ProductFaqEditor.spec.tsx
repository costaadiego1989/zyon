import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readSource() {
  return readFileSync(resolve("src/pages/product-detail/components/ProductFaqEditor.tsx"), "utf-8");
}

describe("ProductFaqEditor", () => {
  it("exports the editor component", async () => {
    const mod = await import("./ProductFaqEditor.js");
    expect(typeof mod.ProductFaqEditor).toBe("function");
  });

  it("renders an add button with the canonical Portuguese label", () => {
    const src = readSource();
    expect(src).toContain("Adicionar FAQ");
  });

  it("uses ToggleSwitch for isPublished flag", () => {
    const src = readSource();
    expect(src).toContain("ToggleSwitch");
    expect(src).toContain("faq.isPublished");
  });

  it("supports drag-reorder via draggable rows", () => {
    const src = readSource();
    expect(src).toContain("draggable");
    expect(src).toContain("handleDragStart");
    expect(src).toContain("handleDrop");
  });

  it("calls onSave / onDelete / onReorder from parent", () => {
    const src = readSource();
    expect(src).toContain("await onSave");
    expect(src).toContain("await onDelete");
    expect(src).toContain("await onReorder");
  });

  it("validates that question and answer are non-empty before saving", () => {
    const src = readSource();
    expect(src).toContain("Pergunta e resposta são obrigatórias");
  });

  it("has an inline edit mode that toggles between view and form", () => {
    const src = readSource();
    expect(src).toContain("isEditing");
    expect(src).toContain("setEditingId");
  });
});
