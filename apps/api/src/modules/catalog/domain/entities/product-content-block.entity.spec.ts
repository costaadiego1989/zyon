import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProductContentBlockEntity,
  ProductContentBlockProps,
  ProductContentBlockType,
} from "./product-content-block.entity.js";

type BlockOverrides = Partial<Omit<ProductContentBlockProps, "createdAt" | "updatedAt" | "locale">> & {
  createdAt?: Date;
  updatedAt?: Date;
  locale?: string;
};

const baseProps = (overrides: BlockOverrides = {}): ProductContentBlockProps => ({
  id: "blk_1",
  productId: "prd_1",
  type: "paragraph",
  props: { text: "hello" },
  order: 0,
  isEnabled: true,
  locale: "pt-BR",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("ProductContentBlockEntity", () => {
  describe("rehydrate() — happy path", () => {
    it("creates a paragraph block", () => {
      const e = ProductContentBlockEntity.rehydrate(baseProps());
      assert.strictEqual(e.id, "blk_1");
      assert.strictEqual(e.productId, "prd_1");
      assert.strictEqual(e.type, "paragraph");
      assert.strictEqual(e.order, 0);
      assert.strictEqual(e.isEnabled, true);
      assert.deepEqual({ ...e.props }, { text: "hello" });
    });

    it("accepts every allowed type literal", () => {
      const types: ProductContentBlockType[] = [
        "paragraph", "heading", "list", "image", "image_text_split",
        "callout", "table", "faq", "video", "carousel", "banner", "button",
      ];
      for (const t of types) {
        const e = ProductContentBlockEntity.rehydrate(baseProps({ type: t }));
        assert.strictEqual(e.type, t);
      }
    });
  });

  describe("rehydrate() — invariants", () => {
    it("rejects empty id", () => {
      assert.throws(
        () => ProductContentBlockEntity.rehydrate(baseProps({ id: "" })),
        /product_content_block_id_required/,
      );
    });

    it("rejects empty productId", () => {
      assert.throws(
        () => ProductContentBlockEntity.rehydrate(baseProps({ productId: "" })),
        /product_content_block_product_id_required/,
      );
    });

    it("rejects unknown type", () => {
      assert.throws(
        () =>
          ProductContentBlockEntity.rehydrate(
            baseProps({ type: "bogus" as ProductContentBlockType }),
          ),
        /product_content_block_unknown_type/,
      );
    });

    it("rejects non-object props", () => {
      assert.throws(
        () =>
          ProductContentBlockEntity.rehydrate(
            baseProps({ props: null as unknown as Record<string, unknown> }),
          ),
        /product_content_block_props_must_be_object/,
      );
    });
  });

  describe("enable() / disable()", () => {
    it("toggles isEnabled immutably", () => {
      const a = ProductContentBlockEntity.rehydrate(baseProps({ isEnabled: true }));
      const b = a.disable();
      assert.strictEqual(a.isEnabled, true, "original is not mutated");
      assert.strictEqual(b.isEnabled, false, "new instance is disabled");
      const c = b.enable();
      assert.strictEqual(b.isEnabled, false, "intermediate is not mutated");
      assert.strictEqual(c.isEnabled, true);
    });

    it("returns same instance when no-op", () => {
      const a = ProductContentBlockEntity.rehydrate(baseProps({ isEnabled: true }));
      assert.strictEqual(a.enable(), a);
      const d = ProductContentBlockEntity.rehydrate(baseProps({ isEnabled: false }));
      assert.strictEqual(d.disable(), d);
    });
  });

  describe("addBlock()", () => {
    it("appends to the end when no index given", () => {
      const a = ProductContentBlockEntity.rehydrate(baseProps());
      const b = ProductContentBlockEntity.rehydrate(baseProps({ id: "blk_2", order: 1 }));
      const next = a.addBlock([], b);
      assert.strictEqual(next.length, 1);
      assert.strictEqual(next[0]!.id, "blk_2");
    });

    it("inserts at the requested index", () => {
      const a = ProductContentBlockEntity.rehydrate(baseProps());
      const b = ProductContentBlockEntity.rehydrate(baseProps({ id: "blk_2" }));
      const c = ProductContentBlockEntity.rehydrate(baseProps({ id: "blk_3" }));
      const result = a.addBlock([b], c, 0);
      assert.deepEqual(result.map((r) => r.id), ["blk_3", "blk_2"]);
    });

    it("does not mutate the input sibling array", () => {
      const a = ProductContentBlockEntity.rehydrate(baseProps());
      const b = ProductContentBlockEntity.rehydrate(baseProps({ id: "blk_2" }));
      const siblings = [b];
      a.addBlock(siblings, b);
      assert.strictEqual(siblings.length, 1);
    });
  });

  describe("moveBlock()", () => {
    it("reorders by id without mutating input", () => {
      const a = ProductContentBlockEntity.rehydrate(baseProps({ id: "a" }));
      const b = ProductContentBlockEntity.rehydrate(baseProps({ id: "b" }));
      const c = ProductContentBlockEntity.rehydrate(baseProps({ id: "c" }));
      const reordered = a.moveBlock([a, b, c], 2);
      assert.deepEqual(reordered.map((r) => r.id), ["b", "c", "a"]);
    });

    it("clamps to valid range", () => {
      const a = ProductContentBlockEntity.rehydrate(baseProps({ id: "a" }));
      const b = ProductContentBlockEntity.rehydrate(baseProps({ id: "b" }));
      const reordered = a.moveBlock([a, b], 99);
      assert.strictEqual(reordered[reordered.length - 1]!.id, "a");
    });

    it("throws when the target is missing", () => {
      const a = ProductContentBlockEntity.rehydrate(baseProps({ id: "a" }));
      const b = ProductContentBlockEntity.rehydrate(baseProps({ id: "b" }));
      assert.throws(() => a.moveBlock([b], 0), /product_content_block_move_target_missing/);
    });
  });
});
