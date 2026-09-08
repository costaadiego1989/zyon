import type { PublicProductContent } from "@/lib/api/product-content";
import type { ProductContentBlock as RendererBlock } from "./ContentBlocks";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((item) => text(item) !== null)
    ? value as string[]
    : null;
}

/**
 * Converts the API's stored `{ type, props }` representation into the safe,
 * discriminated shape rendered by the storefront. Both server and chat paths
 * use this boundary so a rich product looks identical wherever the agent
 * presents it.
 */
export function flattenProductContentBlock(
  raw: PublicProductContent["blocks"][number],
  canPurchase: boolean,
): RendererBlock | null {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || typeof raw.type !== "string") {
    return null;
  }
  if (!raw.isEnabled || !raw.props || typeof raw.props !== "object") return null;

  const props = raw.props as Record<string, unknown>;
  const base = { id: raw.id, order: Number.isInteger(raw.order) && raw.order >= 0 ? raw.order : 0 };

  switch (raw.type) {
    case "paragraph": {
      const value = text(props.text);
      return value ? { ...base, type: "paragraph", text: value } : null;
    }
    case "heading": {
      const value = text(props.text);
      return value ? { ...base, type: "heading", text: value, level: props.level === 3 ? 3 : 2 } : null;
    }
    case "list": {
      const items = stringList(props.items);
      return items ? { ...base, type: "list", items, style: props.style === "ordered" ? "ordered" : "unordered" } : null;
    }
    case "image": {
      const src = text(props.src);
      return src ? { ...base, type: "image", src, alt: typeof props.alt === "string" ? props.alt : "", caption: optionalText(props.caption), width: typeof props.width === "number" ? props.width : undefined, height: typeof props.height === "number" ? props.height : undefined } : null;
    }
    case "image_text_split": {
      const imageSrc = text(props.imageSrc);
      const value = text(props.text);
      return imageSrc && value ? { ...base, type: "image_text_split", imageSrc, imageAlt: typeof props.imageAlt === "string" ? props.imageAlt : "", text: value, heading: optionalText(props.heading), imageSide: props.imageSide === "right" ? "right" : "left" } : null;
    }
    case "callout": {
      const value = text(props.text);
      const tone = ["info", "success", "warn", "danger"].includes(String(props.tone)) ? props.tone as "info" | "success" | "warn" | "danger" : "info";
      return value ? { ...base, type: "callout", text: value, tone, title: optionalText(props.title) } : null;
    }
    case "table": {
      const headers = stringList(props.headers);
      const rows = Array.isArray(props.rows) && props.rows.length > 0 && props.rows.every((row) => stringList(row) !== null)
        ? props.rows as string[][]
        : null;
      return headers && rows ? { ...base, type: "table", headers, rows, caption: optionalText(props.caption) } : null;
    }
    case "faq": {
      const items = Array.isArray(props.items) ? props.items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const question = text(record.question);
        const answer = text(record.answer);
        return question && answer ? [{ question, answer }] : [];
      }) : [];
      return items.length > 0 ? { ...base, type: "faq", items } : null;
    }
    case "video": {
      const ref = text(props.ref);
      const provider = props.provider;
      return ref && (provider === "youtube" || provider === "vimeo" || provider === "mp4")
        ? { ...base, type: "video", provider, ref, caption: optionalText(props.caption), thumbnailUrl: optionalText(props.thumbnailUrl) }
        : null;
    }
    case "carousel": {
      const images = Array.isArray(props.images) ? props.images.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const src = text(record.src);
        return src ? [{ src, alt: typeof record.alt === "string" ? record.alt : "" }] : [];
      }) : [];
      return images.length > 0 ? { ...base, type: "carousel", images, caption: optionalText(props.caption) } : null;
    }
    case "banner": {
      const imageSrc = text(props.imageSrc);
      const isCartAction = props.ctaAction === "add_to_cart" || props.linkUrl === "#checkout";
      return imageSrc ? { ...base, type: "banner", imageSrc, alt: typeof props.alt === "string" ? props.alt : "", caption: optionalText(props.caption), linkUrl: isCartAction && !canPurchase ? undefined : optionalText(props.linkUrl), ctaLabel: optionalText(props.ctaLabel), ctaAction: canPurchase && props.ctaAction === "add_to_cart" ? "add_to_cart" : undefined } : null;
    }
    case "button": {
      const label = text(props.label);
      const linkType = props.linkType === "product" || props.linkType === "add_to_cart" ? props.linkType : "external";
      const productId = optionalText(props.productId);
      const href = optionalText(props.href);
      if ((linkType === "add_to_cart" || href === "#checkout") && !canPurchase) return null;
      if (!label || (linkType === "product" && !productId) || (linkType === "external" && !href)) return null;
      return { ...base, type: "button", label, href, linkType, productId, variant: props.variant === "secondary" ? "secondary" : "primary" };
    }
    default:
      return null;
  }
}

export function flattenProductContentBlocks(content: Pick<PublicProductContent, "blocks" | "purchase">): RendererBlock[] {
  return content.blocks
    .map((block) => flattenProductContentBlock(block, Boolean(content.purchase?.defaultVariantId)))
    .filter((block): block is RendererBlock => block !== null);
}
