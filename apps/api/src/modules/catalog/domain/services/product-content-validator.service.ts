/**
 * ProductContentValidatorService
 *
 * Pure-domain validation entry point for a single block's `props` payload,
 * discriminated by the `type` literal. Reuses the type alias from the
 * ProductContentBlock entity so the runtime allowlist cannot drift from
 * the compile-time type.
 *
 * URL safety: a small allowlist helper enforces http(s) schemes and rejects
 * javascript:, data:, vbscript: (and any other non-http scheme).
 *
 * NO NestJS or Prisma imports. Safe to use from application-layer use-cases
 * and from tests.
 */

import { z } from "zod";
import {
  ProductContentBlockEntity,
  ProductContentBlockProps,
  ProductContentBlockType,
} from "../entities/product-content-block.entity.js";

export const ALLOWED_BLOCK_TYPES = [
  "paragraph",
  "heading",
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
] as const satisfies readonly ProductContentBlockType[];

/**
 * Throws if the value is not a string, is empty, or uses a non-http(s) scheme
 * (in particular: javascript:, data:, vbscript:).
 *
 * Returns the value unchanged on success so it composes inline in zod chains.
 */
export function assertSafeUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("product_content_validator_url_not_string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("product_content_validator_url_empty");
  }
  // Lowercase the scheme check. Whitelist http(s) only.
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    throw new Error("product_content_validator_url_unsafe_scheme");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("product_content_validator_url_malformed");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("product_content_validator_url_non_http_scheme");
  }
  return trimmed;
}

/** Max length cap on any single string field inside a block's props. */
const MAX_PROP_STRING = 4000;
const MAX_BLOCKS = 200;

const safeUrl = z.string().refine(assertSafeUrl, {
  message: "product_content_validator_url_unsafe",
});

const richText = z.string().min(1).max(MAX_PROP_STRING);
const shortText = z.string().min(1).max(280);

/**
 * Per-type `props` schemas. Discriminator is the block-level `type` literal.
 * Unknown type literals fail at the union level with a clear error.
 */
const paragraphProps = z
  .object({
    text: richText,
    align: z.enum(["left", "center", "right"]).optional(),
  })
  .strict();

const headingProps = z
  .object({
    text: richText,
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  })
  .strict();

const listProps = z
  .object({
    style: z.enum(["unordered", "ordered", "checklist"]).default("unordered"),
    items: z.array(z.string().min(1).max(MAX_PROP_STRING)).min(1).max(100),
  })
  .strict();

const imageProps = z
  .object({
    url: safeUrl,
    alt: z.string().max(280).optional(),
    caption: z.string().max(MAX_PROP_STRING).optional(),
    widthPx: z.number().int().positive().max(20000).optional(),
    heightPx: z.number().int().positive().max(20000).optional(),
  })
  .strict();

const imageTextSplitProps = z
  .object({
    imageUrl: safeUrl,
    alt: z.string().max(280).optional(),
    body: richText,
    imageSide: z.enum(["left", "right"]).default("left"),
  })
  .strict();

const calloutProps = z
  .object({
    body: richText,
    tone: z.enum(["info", "success", "warning", "danger"]).default("info"),
    title: shortText.optional(),
  })
  .strict();

const tableProps = z
  .object({
    headers: z.array(z.string().min(1).max(200)).min(1).max(20),
    rows: z
      .array(z.array(z.string().max(MAX_PROP_STRING)).max(20))
      .min(1)
      .max(200),
  })
  .strict();

const faqProps = z
  .object({
    items: z
      .array(
        z
          .object({
            question: z.string().min(1).max(500),
            answer: z.string().min(1).max(MAX_PROP_STRING),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

const videoProps = z
  .object({
    url: safeUrl,
    thumbnailUrl: safeUrl.optional(),
    title: shortText.optional(),
    autoplay: z.boolean().optional(),
  })
  .strict();

const carouselProps = z
  .object({
    images: z
      .array(
        z
          .object({
            url: safeUrl,
            alt: z.string().max(280).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    intervalMs: z.number().int().min(0).max(60_000).optional(),
  })
  .strict();

const bannerProps = z
  .object({
    body: richText,
    linkUrl: safeUrl.optional(),
    tone: z.enum(["info", "success", "warning", "danger", "promo"]).default("info"),
  })
  .strict();

const buttonProps = z
  .object({
    label: shortText,
    linkUrl: safeUrl,
    variant: z.enum(["primary", "secondary", "ghost"]).default("primary"),
  })
  .strict();

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), props: paragraphProps }).strict(),
  z.object({ type: z.literal("heading"), props: headingProps }).strict(),
  z.object({ type: z.literal("list"), props: listProps }).strict(),
  z.object({ type: z.literal("image"), props: imageProps }).strict(),
  z
    .object({ type: z.literal("image_text_split"), props: imageTextSplitProps })
    .strict(),
  z.object({ type: z.literal("callout"), props: calloutProps }).strict(),
  z.object({ type: z.literal("table"), props: tableProps }).strict(),
  z.object({ type: z.literal("faq"), props: faqProps }).strict(),
  z.object({ type: z.literal("video"), props: videoProps }).strict(),
  z.object({ type: z.literal("carousel"), props: carouselProps }).strict(),
  z.object({ type: z.literal("banner"), props: bannerProps }).strict(),
  z.object({ type: z.literal("button"), props: buttonProps }).strict(),
]);

/** Top-level payload: a single block. */
export const blockPayloadSchema = z
  .object({
    type: z.enum(ALLOWED_BLOCK_TYPES),
    props: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Collection payload for bulk updates. */
export const blocksPayloadSchema = z
  .array(blockPayloadSchema)
  .min(0)
  .max(MAX_BLOCKS);

export type ValidatedBlock = z.infer<typeof blockSchema>;

/**
 * Validate one block payload (the `type` + `props` pair — no id / timestamps).
 * Throws a descriptive Error on failure.
 */
export function validateBlock(input: unknown): {
  type: ProductContentBlockType;
  props: Record<string, unknown>;
} {
  const payload = blockPayloadSchema.parse(input);
  // Narrow to the discriminated union. The first parse only checks the
  // envelope; the discriminated union then enforces per-type props.
  const narrowed = blockSchema.parse(payload);
  // Ensure props is a plain object shape (the union narrows it that way).
  return {
    type: narrowed.type,
    props: narrowed.props as unknown as Record<string, unknown>,
  };
}

/** Validate an entire ordered list of blocks (e.g. for bulk save). */
export function validateBlocks(inputs: readonly unknown[]): ReadonlyArray<{
  type: ProductContentBlockType;
  props: Record<string, unknown>;
}> {
  const arr = blocksPayloadSchema.parse(inputs);
  return arr.map((p) => {
    const n = blockSchema.parse(p);
    return {
      type: n.type,
      props: n.props as unknown as Record<string, unknown>,
    };
  });
}

/**
 * Convenience: validate props for an existing block-style record and rebuild
 * a fresh ProductContentBlockProps payload. Useful for repository converts
 * that need to round-trip through validation on write paths.
 */
export type { ProductContentBlockProps };
export { ProductContentBlockEntity };
