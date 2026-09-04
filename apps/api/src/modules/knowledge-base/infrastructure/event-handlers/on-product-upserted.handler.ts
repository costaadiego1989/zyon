import { Injectable, Inject, Logger, Optional, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { IndexProductUseCase } from "../../application/use-cases/index-product.use-case.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

/**
 * Listens to "product.upserted" events and indexes product content into knowledge base.
 * Called when a product is created or updated in the catalog.
 */
@Injectable()
export class OnProductUpsertedHandler implements OnModuleInit {
  private readonly logger = new Logger(OnProductUpsertedHandler.name);

  constructor(
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus | undefined,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly indexProductUseCase: IndexProductUseCase,
  ) {}

  onModuleInit() {
    this.eventBus?.subscribe("product.upserted", async (event) => {
      await this.handle(event.merchantId, event.payload);
    }, "knowledge-base:product.upserted");
  }

  async handle(merchantId: string, payload: unknown): Promise<void> {
    const data = payload as { id?: string; name?: string } | undefined;
    if (!data?.id) return;

    try {
      // Fetch full product with variants and pricing
      const product = await this.prisma.product.findUnique({
        where: { id: data.id },
        include: {
          variants: {
            include: {
              price: true,
              stock: true,
            },
          },
        },
      });

      if (!product || product.merchantId !== merchantId) return;

      // Get quantity from first variant's stock
      const firstStock = product.variants[0]?.stock?.[0];

      await this.indexProductUseCase.execute({
        merchantId,
        productId: product.id,
        name: product.name,
        description: product.description,
        variants: product.variants.map((v) => ({
          sku: v.sku ?? undefined,
          attributes: (v.attributes as Record<string, string>) ?? undefined,
        })),
        priceCents: product.variants[0]?.price?.basePriceInCents ?? undefined,
        quantity: firstStock?.quantity ?? 0,
      });

      this.logger.debug(`Indexed product ${data.id} to knowledge base`);
    } catch (err) {
      this.logger.warn(
        `Failed to index product ${data.id} to knowledge base: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
