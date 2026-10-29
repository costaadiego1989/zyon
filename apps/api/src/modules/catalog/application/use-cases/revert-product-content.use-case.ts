import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PRODUCT_CONTENT_REPOSITORY,
  ProductContentRepositoryPort,
  ProductContentHistoryDetail,
} from "../../domain/ports/product-content-repository.port.js";
import {
  ProductContentBlockEntity,
  ProductContentBlockProps,
  ProductContentBlockType,
  DEFAULT_PRODUCT_CONTENT_LOCALE,
  normalizeProductContentLocale,
} from "../../domain/entities/product-content-block.entity.js";
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from "../../../../shared/events/domain-event-bus.port.js";

/**
 * Revert a product's content blocks to a previously saved history version.
 *
 * Behavior:
 *   1. Load the history snapshot (tenant-scoped via productId → product.merchantId).
 *   2. Snapshot the CURRENT live state into a fresh history row (so the
 *      "before revert" state is also recoverable).
 *   3. Insert the historical blocks back as the live rows, with parent_block_id
 *      pointing at the rows we just snapshotted.
 *   4. Emit `product.content.updated` so CDN purge / analytics subscribers
 *      react to the revert.
 *
 * Returns the restored blocks.
 */
@Injectable()
export class RevertProductContentUseCase {
  private readonly logger = new Logger(RevertProductContentUseCase.name);

  constructor(
    @Inject(PRODUCT_CONTENT_REPOSITORY)
    private readonly contentRepo: ProductContentRepositoryPort,
    @Optional() @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus?: DomainEventBus
  ) {}

  async execute(input: {
    merchantId: string;
    productId: string;
    historyId: string;
    actor: { id: string };
  }): Promise<{
    blocks: ProductContentBlockEntity[];
    version: number;
    locale: string;
  }> {
    const history = await this.contentRepo.findHistoryById({
      merchantId: input.merchantId,
      productId: input.productId,
      historyId: input.historyId,
    });
    if (!history) {
      throw new Error(`product_content_history_not_found:${input.historyId}`);
    }

    const locale = normalizeProductContentLocale(history.locale);
    const blocksToRestore = this.parseSnapshot(history);

    // Forward to replaceAll: it will snapshot current live state then insert
    // the new version. The "savedBy" carries the revert signal as a
    // `revert:<actor>` prefix so audit consumers can distinguish manual
    // saves from reverts. The mechanism of recording `restoredFromVersion`
    // lives at the SQL / Prisma layer in a follow-up migration.
    const restored = await this.contentRepo.replaceAll({
      merchantId: input.merchantId,
      productId: input.productId,
      blocks: blocksToRestore,
      locale,
      savedBy: `revert:${input.actor.id}`,
    });

    if (this.eventBus) {
      await this.eventBus
        .publish({
          eventId: randomUUID(),
          schemaVersion: 1,
          eventType: "product.content.updated",
          merchantId: input.merchantId,
          payload: {
            productId: input.productId,
            enabledBlockCount: restored.filter((b) => b.isEnabled).length,
            variantIds: [],
            source: "bulk_replace",
            revertedFromHistoryId: input.historyId,
            revertedFromVersion: history.version,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `event_publish_failed product.content.updated (revert) product=${input.productId}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
    }

    return {
      blocks: restored,
      version: history.version,
      locale,
    };
  }

  /**
   * Public list — delegates to the repo so the controller can return
   * version history for the dashboard side.
   */
  async listVersions(input: {
    merchantId: string;
    productId: string;
    locale?: string;
    limit?: number;
  }): Promise<Array<{
    id: string;
    version: number;
    savedBy: string;
    savedAt: Date;
    restoredFromVersion: number | null;
  }>> {
    return this.contentRepo.listHistoryVersions(input);
  }

  private parseSnapshot(history: ProductContentHistoryDetail): ProductContentBlockProps[] {
    const snap = history.snapshot as { blocks?: unknown } | null;
    if (!snap || !Array.isArray(snap.blocks)) {
      throw new Error(`product_content_history_corrupt:${history.id}`);
    }
    return (snap.blocks as Array<Record<string, unknown>>).map((b, idx) => {
      const id = String(b.id ?? `restored_${idx}`);
      const productId = String(b.productId ?? "");
      if (!productId) {
        throw new Error(`product_content_history_block_missing_product:${history.id}:${id}`);
      }
      return {
        id,
        productId,
        type: String(b.type ?? "paragraph") as ProductContentBlockType,
        props: (b.props as Record<string, unknown>) ?? {},
        order: typeof b.order === "number" ? b.order : idx,
        isEnabled: typeof b.isEnabled === "boolean" ? b.isEnabled : true,
        locale: normalizeProductContentLocale(
          (b.locale as string | undefined) ?? DEFAULT_PRODUCT_CONTENT_LOCALE
        ),
        createdAt: b.createdAt ? new Date(String(b.createdAt)) : new Date(),
        updatedAt: b.updatedAt ? new Date(String(b.updatedAt)) : new Date(),
      };
    });
  }
}
