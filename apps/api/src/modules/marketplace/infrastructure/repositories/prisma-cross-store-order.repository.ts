import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { hasMarketplaceFulfillmentFunding } from "../../../fulfillment/infrastructure/repositories/marketplace-fulfillment-guard.js";
import type {
  CrossStoreOrderRepository,
  CrossStoreLineItemSnapshot,
  CreateCrossStoreLineItemInput,
  UpdateCrossStoreFulfillmentInput,
} from "../../domain/ports/cross-store-order-repository.port.js";

@Injectable()
export class PrismaCrossStoreOrderRepository
  implements CrossStoreOrderRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateCrossStoreLineItemInput,
  ): Promise<CrossStoreLineItemSnapshot> {
    const item = await this.prisma.crossStoreLineItem.create({
      data: {
        checkoutSessionId: input.checkoutSessionId,
        hostMerchantId: input.hostMerchantId,
        sellerMerchantId: input.sellerMerchantId,
        federatedProductId: input.federatedProductId,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
        commissionRateBps: input.commissionRateBps,
        commissionCents: input.commissionCents,
        sellerNetCents: input.sellerNetCents,
        termsJson: input.termsJson,
      },
    });
    return this.toSnapshot(item);
  }

  async findByCheckoutSessionId(
    checkoutSessionId: string,
    hostMerchantId: string,
  ): Promise<CrossStoreLineItemSnapshot[]> {
    const items = await this.prisma.crossStoreLineItem.findMany({
      where: { checkoutSessionId, hostMerchantId },
    });
    return items.map((i: any) => this.toSnapshot(i));
  }

  async findByOrderId(orderId: string): Promise<CrossStoreLineItemSnapshot[]> {
    const items = await this.prisma.crossStoreLineItem.findMany({
      where: { orderId },
    });
    return items.map((i: any) => this.toSnapshot(i));
  }

  async findBySellerMerchantId(
    sellerMerchantId: string,
  ): Promise<CrossStoreLineItemSnapshot[]> {
    const items = await this.prisma.crossStoreLineItem.findMany({
      where: { sellerMerchantId, orderId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (!items.length) return [];
    const [products, hosts] = await Promise.all([
      this.prisma.federatedProduct.findMany({
        where: { id: { in: [...new Set(items.map((item) => item.federatedProductId))] }, sourceMerchantId: sellerMerchantId },
        select: { id: true, name: true },
      }),
      this.prisma.merchant.findMany({
        where: { id: { in: [...new Set(items.map((item) => item.hostMerchantId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const productNames = new Map(products.map((product) => [product.id, product.name]));
    const hostNames = new Map(hosts.map((host) => [host.id, host.name]));
    return items.map((item) => ({ ...this.toSnapshot(item),
      productName: productNames.get(item.federatedProductId), hostStoreName: hostNames.get(item.hostMerchantId) }));
  }

  async findByIdForSeller(
    lineItemId: string,
    sellerMerchantId: string,
  ): Promise<CrossStoreLineItemSnapshot | undefined> {
    const item = await this.prisma.crossStoreLineItem.findFirst({
      where: { id: lineItemId, sellerMerchantId },
    });
    return item ? this.toSnapshot(item) : undefined;
  }

  async updateFulfillment(
    input: UpdateCrossStoreFulfillmentInput,
  ): Promise<CrossStoreLineItemSnapshot | undefined> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.crossStoreLineItem.findFirst({ where: { id: input.lineItemId, sellerMerchantId: input.sellerMerchantId } });
      if (!current || !current.orderId) return undefined;
      if (await hasMarketplaceFulfillmentFunding(tx, { merchantId: current.hostMerchantId,
        orderId: current.orderId, checkoutCartRef: current.checkoutSessionId,
      })) throw new ConflictException("marketplace_delivery_proof_required");
      const updated = await tx.crossStoreLineItem.updateMany({
        where: {
          id: input.lineItemId,
          sellerMerchantId: input.sellerMerchantId,
          fulfillmentStatus: input.expectedStatus,
        },
        data: {
          fulfillmentStatus: input.status,
          ...(input.fulfillmentReference === undefined
            ? {}
            : { fulfillmentReference: input.fulfillmentReference }),
        },
      });
      if (updated.count !== 1) return undefined;
      const item = await tx.crossStoreLineItem.findFirst({ where: { id: input.lineItemId, sellerMerchantId: input.sellerMerchantId } });
      return item ? this.toSnapshot(item) : undefined;
    });
  }

  async updateOrderId(
    lineItemId: string,
    orderId: string,
  ): Promise<CrossStoreLineItemSnapshot> {
    const item = await this.prisma.crossStoreLineItem.update({
      where: { id: lineItemId, OR: [{ orderId: null }, { orderId }] },
      data: { orderId },
    });
    return this.toSnapshot(item);
  }

  private toSnapshot(item: any): CrossStoreLineItemSnapshot {
    return {
      id: item.id,
      checkoutSessionId: item.checkoutSessionId,
      orderId: item.orderId,
      hostMerchantId: item.hostMerchantId,
      sellerMerchantId: item.sellerMerchantId,
      federatedProductId: item.federatedProductId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      commissionRateBps: item.commissionRateBps,
      commissionCents: item.commissionCents,
      sellerNetCents: item.sellerNetCents,
      purchasedAt: item.purchasedAt,
      termsJson: item.termsJson ?? undefined,
      fulfillmentStatus: item.fulfillmentStatus,
      fulfillmentReference: item.fulfillmentReference,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
