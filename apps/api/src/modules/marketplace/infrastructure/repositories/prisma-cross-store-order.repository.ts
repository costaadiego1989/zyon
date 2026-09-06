import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
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
      },
    });
    return this.toSnapshot(item);
  }

  async findByCheckoutSessionId(
    checkoutSessionId: string,
  ): Promise<CrossStoreLineItemSnapshot[]> {
    const items = await this.prisma.crossStoreLineItem.findMany({
      where: { checkoutSessionId },
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
      where: { sellerMerchantId },
      orderBy: { createdAt: "desc" },
    });
    return items.map((i: any) => this.toSnapshot(i));
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
    const updated = await this.prisma.crossStoreLineItem.updateMany({
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
    return this.findByIdForSeller(input.lineItemId, input.sellerMerchantId);
  }

  async updateOrderId(
    lineItemId: string,
    orderId: string,
  ): Promise<CrossStoreLineItemSnapshot> {
    const item = await this.prisma.crossStoreLineItem.update({
      where: { id: lineItemId },
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
      fulfillmentStatus: item.fulfillmentStatus,
      fulfillmentReference: item.fulfillmentReference,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
