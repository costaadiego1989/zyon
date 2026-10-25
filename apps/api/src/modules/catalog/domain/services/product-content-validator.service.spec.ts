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

    it("accepts the image shape emitted by the dashboard editor", () => {
      const r = validateBlock({
        type: "image",
        props: {
          src: "https://cdn.example.com/photo.jpg",
          alt: "Photo of product",
        },
      });
      assert.strictEqual(r.type, "image");
    });

    it("accepts the callout shape emitted by the dashboard editor", () => {
      const r = validateBlock({
        type: "callout",
        props: { text: "Heads up!", tone: "warn" },
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

    it("accepts the banner shape emitted by the dashboard editor", () => {
      const r = validateBlock({
        type: "banner",
        props: {
          imageSrc: "https://cdn.example.com/sale.jpg",
          alt: "Free shipping today only",
          caption: "Free shipping today only",
          linkUrl: "https://shop.example.com/sale",
          ctaLabel: "See offer",
        },
      });
      assert.strictEqual(r.type, "banner");
    });

    it("accepts button", () => {
      const r = validateBlock({
        type: "button",
        props: { label: "Buy now", href: "https://shop.example.com/x" },
      });
      assert.strictEqual(r.type, "button");
    });

    it("normalizes a YouTube share URL into the renderer video id", () => {
      const r = validateBlock({
        type: "video",
        props: { provider: "youtube", ref: "https://youtu.be/dQw4w9WgXcQ", caption: "Demo" },
      });
      assert.strictEqual((r.props as { ref: string }).ref, "dQw4w9WgXcQ");
    });

    it("accepts an internal product button target", () => {
      const r = validateBlock({
        type: "button",
        props: { label: "Ver produto", linkType: "product", productId: "prod_123" },
      });
      assert.strictEqual(r.type, "button");
    });

    it("accepts a semantic current-product cart CTA without a URL", () => {
      const button = validateBlock({
        type: "button",
        props: { label: "Adicionar", linkType: "add_to_cart" },
      });
      const banner = validateBlock({
        type: "banner",
        props: { imageSrc: "https://cdn.example.com/product.jpg", ctaAction: "add_to_cart" },
      });
      assert.strictEqual(button.type, "button");
      assert.strictEqual(banner.type, "banner");
    });

    it("rejects an ambiguous banner cart action and external URL", () => {
      assert.throws(
        () => validateBlock({
          type: "banner",
          props: { imageSrc: "https://cdn.example.com/product.jpg", ctaAction: "add_to_cart", linkUrl: "https://example.com" },
        }),
        /conflicts_with_url/,
      );
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

    it("rejects javascript: URL in image.src", () => {
      assert.throws(
        () =>
          validateBlock({
            type: "image",
            props: { src: "javascript:alert(1)" },
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
              imageSrc: "https://cdn.example.com/sale.jpg",
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
              src: "https://cdn.example.com/x.jpg",
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
