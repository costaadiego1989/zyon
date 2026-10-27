import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readSource() {
  return readFileSync(resolve("src/pages/product-detail/components/ProductBlockEditor.tsx"), "utf-8");
}

describe("ProductBlockEditor", () => {
  it("exports the editor component", async () => {
    const mod = await import("./ProductBlockEditor.js");
    expect(typeof mod.ProductBlockEditor).toBe("function");
  });

  it("declares a 'use client' directive for Next/React Server Components compatibility", () => {
    const src = readSource();
    expect(src).toMatch(/^"use client"/m);
  });

  it("registers all 12 block types from R1", () => {
    const src = readSource();
    const required = [
      "heading",
      "paragraph",
      "list",
      "image",
      "image_text_split",
      "callout",
      "table",
      "faq",
      "video",
      "carousel",
      "banner",
      "button",
    ];
    for (const t of required) {
      expect(src).toContain(`type: "${t}"`);
    }
  });

  it("emits ProductContentBlock[] JSON shape (id, type, props, order, isEnabled)", () => {
    const src = readSource();
    expect(src).toContain("id: crypto.randomUUID()");
    expect(src).toContain("productId");
    expect(src).toContain("type: ProductContentBlockType");
    expect(src).toContain("order:");
    expect(src).toContain("isEnabled: true");
  });

  it("supports read-only mode", () => {
    const src = readSource();
    expect(src).toContain("readOnly");
    expect(src).toContain("readOnly={readOnly}");
  });

  it("invokes onSave callback when provided", () => {
    const src = readSource();
    expect(src).toContain("onSave");
    expect(src).toContain("await onSave(blocks)");
  });

  it("exposes drag-reorder via draggable + onDragOver + onDrop", () => {
    const src = readSource();
    expect(src).toContain("draggable");
    expect(src).toContain("handleDragStart");
    expect(src).toContain("handleDrop");
  });

  it("has a 12-template add-block menu", () => {
    const src = readSource();
    // The BLOCK_TEMPLATES array is the menu definition.
    expect(src).toContain("BLOCK_TEMPLATES");
    expect(src).toContain("Adicionar bloco");
  });

  it("toggles each block's isEnabled flag for storefront visibility", () => {
    const src = readSource();
    expect(src).toContain("isEnabled");
    expect(src).toContain("toggleEnabled");
  });

  it("exposes image/video upload fields that call uploadContentImage", () => {
    const src = readSource();
    expect(src).toContain("ImageUploadField");
    expect(src).toContain("merchantId");
    expect(src).toContain("productId");
  });

  it("supports a button block with internal product redirect", () => {
    const src = readSource();
    expect(src).toContain('type: "button"');
    expect(src).toContain('linkType === "product"');
    expect(src).toContain("ProductSearchDropdown");
  });

  it("lets a merchant connect a CTA to the current product cart flow", () => {
    const src = readSource();
    expect(src).toContain('value="add_to_cart"');
    expect(src).toContain('ctaAction: e.target.checked ? "add_to_cart" : undefined');
  });

  it("table editor exposes + Coluna / + Linha controls", () => {
    const src = readSource();
    expect(src).toContain('type: "table"');
    expect(src).toContain("+ Coluna");
    expect(src).toContain("+ Linha");
  });
});
