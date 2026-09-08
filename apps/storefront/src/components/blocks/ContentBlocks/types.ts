// Discriminated union of content blocks used inside a `product_content` block.
// All blocks live under an `order` index so the renderer can preserve authoring
// order even if the array arrives shuffled.

export interface ParagraphBlockData {
  type: "paragraph";
  id: string;
  order: number;
  text: string;
}

export interface HeadingBlockData {
  type: "heading";
  id: string;
  order: number;
  level: 2 | 3;
  text: string;
}

export interface ListBlockData {
  type: "list";
  id: string;
  order: number;
  style: "unordered" | "ordered";
  items: string[];
}

export interface ImageBlockData {
  type: "image";
  id: string;
  order: number;
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface ImageTextSplitBlockData {
  type: "image_text_split";
  id: string;
  order: number;
  imageSide: "left" | "right";
  imageSrc: string;
  imageAlt: string;
  text: string;
  heading?: string;
}

export interface CalloutBlockData {
  type: "callout";
  id: string;
  order: number;
  tone: "info" | "success" | "warn" | "danger";
  title?: string;
  text: string;
}

export interface TableBlockData {
  type: "table";
  id: string;
  order: number;
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqBlockData {
  type: "faq";
  id: string;
  order: number;
  items: FaqItem[];
}

export interface VideoBlockData {
  type: "video";
  id: string;
  order: number;
  /** Direct mp4 URL (https only) or one of: "youtube" | "vimeo". */
  provider: "youtube" | "vimeo" | "mp4";
  /** For embed providers: the video id. For mp4: the full https URL. */
  ref: string;
  /** Optional caption rendered below the player. */
  caption?: string;
  thumbnailUrl?: string;
}

export interface CarouselBlockData {
  type: "carousel";
  id: string;
  order: number;
  images: Array<{ src: string; alt: string }>;
  /** Optional caption rendered below the carousel. */
  caption?: string;
}

export interface BannerBlockData {
  type: "banner";
  id: string;
  order: number;
  imageSrc: string;
  alt: string;
  /** Optional caption / overlay copy. */
  caption?: string;
  linkUrl?: string;
  /** Optional label for the CTA button (only shown when linkUrl is set). */
  ctaLabel?: string;
  /** Semantic storefront action; no client-provided price is accepted. */
  ctaAction?: "add_to_cart";
}

export interface ButtonBlockData {
  type: "button";
  id: string;
  order: number;
  label: string;
  /** External target when `linkType` is omitted or `external`. */
  href?: string;
  /** Product links stay relative so they preserve the current store slug. */
  linkType?: "external" | "product" | "add_to_cart";
  productId?: string;
  variant: "primary" | "secondary";
}

export type ProductContentBlock =
  | ParagraphBlockData
  | HeadingBlockData
  | ListBlockData
  | ImageBlockData
  | ImageTextSplitBlockData
  | CalloutBlockData
  | TableBlockData
  | FaqBlockData
  | VideoBlockData
  | CarouselBlockData
  | BannerBlockData
  | ButtonBlockData;

export type ProductContentBlockProps =
  | { block: ParagraphBlockData; onCtaClick?: (href: string) => void }
  | { block: HeadingBlockData; onCtaClick?: (href: string) => void }
  | { block: ListBlockData; onCtaClick?: (href: string) => void }
  | { block: ImageBlockData; onCtaClick?: (href: string) => void }
  | { block: ImageTextSplitBlockData; onCtaClick?: (href: string) => void }
  | { block: CalloutBlockData; onCtaClick?: (href: string) => void }
  | { block: TableBlockData; onCtaClick?: (href: string) => void }
  | { block: FaqBlockData; onCtaClick?: (href: string) => void }
  | { block: VideoBlockData; onCtaClick?: (href: string) => void }
  | { block: CarouselBlockData; onCtaClick?: (href: string) => void }
  | { block: BannerBlockData; onCtaClick?: (href: string) => void }
  | { block: ButtonBlockData; onCtaClick?: (href: string) => void };
