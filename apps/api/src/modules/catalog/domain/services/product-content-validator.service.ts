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

const optionalSafeUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  safeUrl.optional(),
);

const richText = z.string().min(1).max(MAX_PROP_STRING);
const shortText = z.string().min(1).max(280);

/**
 * Per-type `props` schemas. Discriminator is the block-level `type` literal.
 * Unknown type literals fail at the union level with a clear error.
 */
const paragraphProps = z
  .object({
    text: richText,
  })
  .strict();

const headingProps = z
  .object({
    text: richText,
    level: z.union([z.literal(2), z.literal(3)]).default(2),
  })
  .strict();

const listProps = z
  .object({
    style: z.enum(["unordered", "ordered"]).default("unordered"),
    items: z.array(z.string().min(1).max(MAX_PROP_STRING)).min(1).max(100),
  })
  .strict();

const imageProps = z
  .object({
    src: safeUrl,
    alt: z.string().max(280).default(""),
    caption: z.string().max(MAX_PROP_STRING).optional(),
    width: z.number().int().positive().max(20000).optional(),
    height: z.number().int().positive().max(20000).optional(),
  })
  .strict();

const imageTextSplitProps = z
  .object({
    imageSrc: safeUrl,
    imageAlt: z.string().max(280).default(""),
    text: richText,
    heading: shortText.optional(),
    imageSide: z.enum(["left", "right"]).default("left"),
  })
  .strict();

const calloutProps = z
  .object({
    text: richText,
    tone: z.enum(["info", "success", "warn", "danger"]).default("info"),
    title: shortText.optional(),
  })
  .strict();

const tableProps = z
  .object({
    caption: z.string().max(MAX_PROP_STRING).optional(),
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
    provider: z.enum(["youtube", "vimeo", "mp4"]),
    ref: z.string().trim().min(1).max(2048),
    caption: z.string().max(MAX_PROP_STRING).optional(),
  })
  .strict();

const carouselProps = z
  .object({
    images: z
      .array(
        z
          .object({
            src: safeUrl,
            alt: z.string().max(280).default(""),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    caption: z.string().max(MAX_PROP_STRING).optional(),
  })
  .strict();

const bannerProps = z
  .object({
    imageSrc: safeUrl,
    alt: z.string().max(280).default(""),
    caption: z.string().max(MAX_PROP_STRING).optional(),
    linkUrl: optionalSafeUrl,
    ctaLabel: z.string().max(280).optional(),
    ctaAction: z.enum(["add_to_cart"]).optional(),
  })
  .strict()
  .superRefine((props, ctx) => {
    if (props.ctaAction && props.linkUrl) {
      ctx.addIssue({
        code: "custom",
        message: "product_content_validator_banner_cta_action_conflicts_with_url",
      });
    }
  });

const buttonProps = z
  .object({
    label: shortText,
    href: optionalSafeUrl,
    linkType: z.enum(["external", "product", "add_to_cart"]).default("external"),
    productId: z.string().trim().min(1).max(191).optional(),
    variant: z.enum(["primary", "secondary"]).default("primary"),
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
 * Canonicalize a dashboard video reference before persistence. The editor
 * accepts either a provider id or a share URL; the renderer only needs the
 * stable provider id. Keeping this conversion at the API boundary prevents a
 * valid dashboard submission from becoming an invisible storefront block.
 */
function normalizeVideoReference(provider: "youtube" | "vimeo" | "mp4", ref: string): string {
  if (provider === "mp4") {
    return assertSafeUrl(ref);
  }

  if (provider === "youtube") {
    let id = ref.trim();
    if (/^https?:\/\//i.test(id)) {
      try {
        const url = new URL(id);
        const host = url.hostname.toLowerCase();
        if (host === "youtu.be" || host === "www.youtu.be") {
          id = url.pathname.split("/").filter(Boolean)[0] ?? "";
        } else if (host === "youtube.com" || host === "www.youtube.com") {
          id =
            url.searchParams.get("v") ??
            url.pathname.split("/").filter(Boolean).filter((part) => part !== "embed" && part !== "shorts")[0] ??
            "";
        }
      } catch {
        id = "";
      }
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      throw new Error("product_content_validator_youtube_ref_invalid");
    }
    return id;
  }

  let id = ref.trim();
  if (/^https?:\/\//i.test(id)) {
    try {
      const url = new URL(id);
      const host = url.hostname.toLowerCase();
      if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
        id = [...url.pathname.split("/").filter(Boolean)]
          .reverse()
          .find((part) => /^\d+$/.test(part)) ?? "";
      }
    } catch {
      id = "";
    }
  }
  if (!/^\d{6,12}$/.test(id)) {
    throw new Error("product_content_validator_vimeo_ref_invalid");
  }
  return id;
}

function validateConditionalProps(
  type: ProductContentBlockType,
  props: Record<string, unknown>,
): void {
  if (type === "button") {
    const button = props as {
      href?: string;
      linkType: "external" | "product" | "add_to_cart";
      productId?: string;
    };
    if (button.linkType === "product" && !button.productId) {
      throw new Error("product_content_validator_button_product_required");
    }
    if (button.linkType === "external" && !button.href) {
      throw new Error("product_content_validator_button_href_required");
    }
  }
}

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
  const props = narrowed.props as Record<string, unknown>;
  validateConditionalProps(narrowed.type, props);
  if (narrowed.type === "video") {
    const video = props as { provider: "youtube" | "vimeo" | "mp4"; ref: string };
    props.ref = normalizeVideoReference(video.provider, video.ref);
  }
  // Ensure props is a plain object shape (the union narrows it that way).
  return {
    type: narrowed.type,
    props,
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
    const props = n.props as Record<string, unknown>;
    validateConditionalProps(n.type, props);
    if (n.type === "video") {
      const video = props as { provider: "youtube" | "vimeo" | "mp4"; ref: string };
      props.ref = normalizeVideoReference(video.provider, video.ref);
    }
    return {
      type: n.type,
      props,
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
