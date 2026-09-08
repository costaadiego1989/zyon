/**
 * ProductContentBlockEntity
 *
 * One ordered, typed content block attached to a Product. The entity is pure:
 * it carries no Prisma or NestJS dependency. Repositories hydrate rows into
 * this shape via `rehydrate()` and persist via their own converters.
 *
 * The 12 allowed `type` literals are the discriminator that the
 * `ProductContentValidatorService` (zod) uses to validate the per-type
 * `props` shape. Any unknown type is rejected at construction time.
 *
 * Wave 3 i18n: every block is tagged with a normalized `locale` (BCP-47
 * style, e.g. `pt-BR`, `en`, `es`). `rehydrate()` runs the locale through
 * `normalizeProductContentLocale()` so callers can pass loosely-formatted
 * input ("PT-br", "en_us") and the entity always sees canonical form.
 *
 * Immutable: all transformation methods return a NEW instance.
 */

/**
 * Canonical default locale when the caller does not specify one.
 * Tenant-wide content surface stays pt-BR unless a merchant opts in to
 * additional locales per product.
 */
export const DEFAULT_PRODUCT_CONTENT_LOCALE = "pt-BR";

/**
 * Loose BCP-47 normalizer. Accepts loose casing / separator input
 * ("PT_br", "en-US", "es") and emits canonical case ("pt-BR", "en-US",
 * "es"). Unknown shapes fall back to the default locale rather than
 * throw — the store-side is forgiving so a misconfigured Accept-Language
 * header never 5xx's the public storefront.
 */
export function normalizeProductContentLocale(
  input: string | undefined | null,
): string {
  if (typeof input !== "string") return DEFAULT_PRODUCT_CONTENT_LOCALE;
  const trimmed = input.trim();
  if (trimmed.length === 0) return DEFAULT_PRODUCT_CONTENT_LOCALE;

  // Accept both '-' and '_' as language/region separators.
  const [rawLang, rawRegion] = trimmed.split(/[-_]/);
  if (!rawLang) return DEFAULT_PRODUCT_CONTENT_LOCALE;

  const lang = rawLang.toLowerCase();
  const region = rawRegion ? rawRegion.toUpperCase() : undefined;

  // Minimal BCP-47 shape: language is 2-3 alpha chars; region, when present,
  // is 2 alpha chars or 3 digits. Anything else falls back.
  const LANG_OK = /^[a-z]{2,3}$/.test(lang);
  const REGION_OK =
    region === undefined ||
    /^[A-Z]{2}$/.test(region) ||
    /^[0-9]{3}$/.test(region);
  if (!LANG_OK || !REGION_OK) return DEFAULT_PRODUCT_CONTENT_LOCALE;

  return region ? `${lang}-${region}` : lang;
}

export type ProductContentBlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "image"
  | "image_text_split"
  | "callout"
  | "table"
  | "faq"
  | "video"
  | "carousel"
  | "banner"
  | "button";

export interface ProductContentBlockProps {
  id: string;
  productId: string;
  type: ProductContentBlockType;
  props: Record<string, unknown>;
  order: number;
  isEnabled: boolean;
  /** BCP-47 style locale tag; default `pt-BR`. Normalized via `normalizeProductContentLocale`. */
  locale: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ProductContentBlockEntity {
  private static readonly ALLOWED_TYPES: ReadonlySet<ProductContentBlockType> =
    new Set<ProductContentBlockType>([
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
    ]);

  readonly id: string;
  readonly productId: string;
  readonly type: ProductContentBlockType;
  readonly props: Readonly<Record<string, unknown>>;
  readonly order: number;
  readonly isEnabled: boolean;
  readonly locale: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ProductContentBlockProps) {
    this.id = props.id;
    this.productId = props.productId;
    this.type = props.type;
    this.props = Object.freeze({ ...props.props });
    this.order = props.order;
    this.isEnabled = props.isEnabled;
    this.locale = normalizeProductContentLocale(props.locale);
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /**
   * Hydrate a persisted row back into an entity. Repository layer is
   * responsible for verifying the row was loaded for the correct tenant
   * before calling rehydrate. Performs only type-shape validation; deep
   * `props` validation is the validator service's job.
   */
  static rehydrate(props: ProductContentBlockProps): ProductContentBlockEntity {
    if (!props.id || props.id.length === 0) {
      throw new Error("product_content_block_id_required");
    }
    if (!props.productId || props.productId.length === 0) {
      throw new Error("product_content_block_product_id_required");
    }
    if (!ProductContentBlockEntity.ALLOWED_TYPES.has(props.type)) {
      throw new Error(
        `product_content_block_unknown_type:${String(props.type)}`,
      );
    }
    if (props.props === null || typeof props.props !== "object") {
      throw new Error("product_content_block_props_must_be_object");
    }

    return new ProductContentBlockEntity(props);
  }

  /**
   * Replace the entire set of blocks attached to a product. Returns a new
   * array of immutable entities (the input array is not mutated).
   */
  static replaceBlocks(blocks: ProductContentBlockEntity[]): ProductContentBlockEntity[] {
    return blocks.map((b) => b.withUpdatedAt(new Date()));
  }

  /** Mark this block as disabled (soft-off) — immutable. */
  disable(): ProductContentBlockEntity {
    if (!this.isEnabled) return this;
    return new ProductContentBlockEntity({
      ...this.toProps(),
      isEnabled: false,
      updatedAt: new Date(),
    });
  }

  /** Mark this block as enabled — immutable. */
  enable(): ProductContentBlockEntity {
    if (this.isEnabled) return this;
    return new ProductContentBlockEntity({
      ...this.toProps(),
      isEnabled: true,
      updatedAt: new Date(),
    });
  }

  /** Insert a sibling block at the requested index — immutable. */
  addBlock(
    siblings: readonly ProductContentBlockEntity[],
    block: ProductContentBlockEntity,
    atIndex?: number,
  ): readonly ProductContentBlockEntity[] {
    const next = [...siblings];
    const insertAt =
      atIndex === undefined
        ? next.length
        : Math.max(0, Math.min(atIndex, next.length));
    next.splice(insertAt, 0, block);
    return ProductContentBlockEntity.replaceBlocks(next);
  }

  /**
   * Move this block to a new index within `siblings`. Returns a NEW sorted
   * array; the receiver and siblings are not mutated. Negative / out-of-range
   * indices are clamped to [0, length-1].
   */
  moveBlock(
    siblings: readonly ProductContentBlockEntity[],
    toIndex: number,
  ): readonly ProductContentBlockEntity[] {
    const list = [...siblings];
    const fromIndex = list.findIndex((b) => b.id === this.id);
    if (fromIndex < 0) {
      throw new Error("product_content_block_move_target_missing");
    }
    const [picked] = list.splice(fromIndex, 1);
    const target = Math.max(0, Math.min(toIndex, list.length));
    list.splice(target, 0, picked);
    return ProductContentBlockEntity.replaceBlocks(list);
  }

  /** Internal accessor for clone-and-mutate operations. */
  private toProps(): ProductContentBlockProps {
    return {
      id: this.id,
      productId: this.productId,
      type: this.type,
      props: { ...this.props },
      order: this.order,
      isEnabled: this.isEnabled,
      locale: this.locale,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /** Return a fresh clone with the given `updatedAt` timestamp. */
  private withUpdatedAt(at: Date): ProductContentBlockEntity {
    return new ProductContentBlockEntity({ ...this.toProps(), updatedAt: at });
  }
}
