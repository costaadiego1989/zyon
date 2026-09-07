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
 * Immutable: all transformation methods return a NEW instance.
 */

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
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ProductContentBlockProps) {
    this.id = props.id;
    this.productId = props.productId;
    this.type = props.type;
    this.props = Object.freeze({ ...props.props });
    this.order = props.order;
    this.isEnabled = props.isEnabled;
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
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /** Return a fresh clone with the given `updatedAt` timestamp. */
  private withUpdatedAt(at: Date): ProductContentBlockEntity {
    return new ProductContentBlockEntity({ ...this.toProps(), updatedAt: at });
  }
}
