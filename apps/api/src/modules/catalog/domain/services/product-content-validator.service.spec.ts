import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_BLOCK_TYPES,
  assertSafeUrl,
  validateBlock,
  validateBlocks,
} from "./product-content-validator.service.js";

describe("ProductContentValidatorService", () => {
  describe("ALLOWED_BLOCK_TYPES", () => {
    it("exposes the 12 type literals", () => {
      assert.strictEqual(ALLOWED_BLOCK_TYPES.length, 12);
      assert.ok(ALLOWED_BLOCK_TYPES.includes("paragraph"));
      assert.ok(ALLOWED_BLOCK_TYPES.includes("banner"));
      assert.ok(ALLOWED_BLOCK_TYPES.includes("button"));
    });
  });

  describe("assertSafeUrl()", () => {
    it("accepts https://", () => {
      assert.strictEqual(
        assertSafeUrl("https://cdn.example.com/img.png"),
        "https://cdn.example.com/img.png",
      );
    });

    it("accepts http://", () => {
      assert.strictEqual(
        assertSafeUrl("http://example.com/file.jpg"),
        "http://example.com/file.jpg",
      );
    });

    it("rejects javascript: URLs", () => {
      assert.throws(
        () => assertSafeUrl("javascript:alert(1)"),
        /product_content_validator_url_unsafe_scheme/,
      );
    });

    it("rejects data: URLs", () => {
      assert.throws(
        () => assertSafeUrl("data:text/html,<script>alert(1)</script>"),
        /product_content_validator_url_unsafe_scheme/,
      );
    });

    it("rejects vbscript: URLs", () => {
      assert.throws(
        () => assertSafeUrl("vbscript:msgbox(1)"),
        /product_content_validator_url_unsafe_scheme/,
      );
    });

    it("rejects file:// URLs (non-http scheme)", () => {
      assert.throws(
        () => assertSafeUrl("file:///etc/passwd"),
        /product_content_validator_url_non_http_scheme/,
      );
    });

    it("rejects malformed URLs", () => {
      assert.throws(
        () => assertSafeUrl("not a url at all"),
        /product_content_validator_url_malformed/,
      );
    });

    it("rejects empty string", () => {
      assert.throws(
        () => assertSafeUrl(""),
        /product_content_validator_url_empty/,
      );
    });

    it("rejects non-string values", () => {
      assert.throws(
        () => assertSafeUrl(123),
        /product_content_validator_url_not_string/,
      );
    });
  });

  describe("validateBlock() — happy paths (>= 6 cases)", () => {
    it("accepts paragraph", () => {
      const r = validateBlock({ type: "paragraph", props: { text: "Hello." } });
      assert.strictEqual(r.type, "paragraph");
      assert.strictEqual((r.props as { text: string }).text, "Hello.");
    });

    it("accepts heading", () => {
      const r = validateBlock({
        type: "heading",
        props: { text: "Title", level: 2 },
      });
      assert.strictEqual(r.type, "heading");
      assert.strictEqual((r.props as { level: number }).level, 2);
    });

    it("accepts image with safe URL", () => {
      const r = validateBlock({
        type: "image",
        props: {
          url: "https://cdn.example.com/photo.jpg",
          alt: "Photo of product",
        },
      });
      assert.strictEqual(r.type, "image");
    });

    it("accepts callout", () => {
      const r = validateBlock({
        type: "callout",
        props: { body: "Heads up!", tone: "warning" },
      });
      assert.strictEqual(r.type, "callout");
    });

    it("accepts faq items", () => {
      const r = validateBlock({
        type: "faq",
        props: {
          items: [
            { question: "Q1?", answer: "A1." },
            { question: "Q2?", answer: "A2." },
          ],
        },
      });
      assert.strictEqual(r.type, "faq");
    });

    it("accepts banner with linkUrl", () => {
      const r = validateBlock({
        type: "banner",
        props: {
          body: "Free shipping today only",
          linkUrl: "https://shop.example.com/sale",
          tone: "promo",
        },
      });
      assert.strictEqual(r.type, "banner");
    });

    it("accepts button", () => {
      const r = validateBlock({
        type: "button",
        props: { label: "Buy now", linkUrl: "https://shop.example.com/x" },
      });
      assert.strictEqual(r.type, "button");
    });
  });

  describe("validateBlock() — rejections (>= 6 cases)", () => {
    it("rejects unknown type literal", () => {
      assert.throws(
        () => validateBlock({ type: "mystery", props: {} }),
        /Invalid discriminator value|Invalid enum value|invalid_value/,
      );
    });

    it("rejects unknown extra keys in props (strict shape)", () => {
      // The per-type schema is .strict() — any unknown prop key must be rejected.
      assert.throws(
        () =>
          validateBlock({
            type: "paragraph",
            props: { text: "Hi", injected: "<script>alert(1)</script>" },
          }),
        /Unknown|unrecognized/i,
      );
    });

    it("rejects javascript: URL in image.url", () => {
      assert.throws(
        () =>
          validateBlock({
            type: "image",
            props: { url: "javascript:alert(1)" },
          }),
        /product_content_validator_url/,
      );
    });

    it("rejects data: URL in banner.linkUrl", () => {
      assert.throws(
        () =>
          validateBlock({
            type: "banner",
            props: {
              body: "Click me",
              linkUrl: "data:text/html,<script>alert(1)</script>",
            },
          }),
        /product_content_validator_url/,
      );
    });

    it("rejects rating out of range (block-shape)", () => {
      // No block type accepts a `rating` field; an unknown prop key should be
      // rejected by the per-type .strict() schemas (image is one).
      assert.throws(
        () =>
          validateBlock({
            type: "image",
            props: {
              url: "https://cdn.example.com/x.jpg",
              rating: 99,
            },
          }),
        /Unknown|rating/i,
      );
    });

    it("rejects missing required field (paragraph without text)", () => {
      assert.throws(
        () => validateBlock({ type: "paragraph", props: {} }),
        /Required|text/i,
      );
    });

    it("rejects bad type literal value (numeric)", () => {
      assert.throws(
        () => validateBlock({ type: 42, props: {} }),
        /Invalid|Expected/,
      );
    });
  });

  describe("validateBlocks() — bulk path", () => {
    it("accepts an empty array", () => {
      assert.deepEqual([...validateBlocks([])], []);
    });

    it("accepts a mixed list and preserves order", () => {
      const r = validateBlocks([
        { type: "heading", props: { text: "Hi" } },
        { type: "paragraph", props: { text: "Body." } },
      ]);
      assert.strictEqual(r.length, 2);
      assert.strictEqual(r[0]!.type, "heading");
      assert.strictEqual(r[1]!.type, "paragraph");
    });

    it("rejects when any block is invalid", () => {
      assert.throws(
        () =>
          validateBlocks([
            { type: "paragraph", props: { text: "ok" } },
            { type: "paragraph", props: {} },
          ]),
        /Required|text/i,
      );
    });
  });
});
