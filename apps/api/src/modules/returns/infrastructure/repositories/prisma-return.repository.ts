import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import {
  ReturnRepositoryPort,
  CreateReturnInput,
  ListReturnsInput,
  ListReturnsResult,
  SaveLabelInput,
  SaveInspectionInput,
  SaveRefundInput,
} from "../../domain/ports/return-repository.port.js";
import {
  ReturnEntity,
  ReturnStatus,
  ReturnLabelProps,
  ReturnInspectionProps,
  ReturnRefundProps,
} from "../../domain/entities/return.entity.js";

@Injectable()
export class PrismaReturnRepository implements ReturnRepositoryPort {
  private readonly logger = new Logger(PrismaReturnRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateReturnInput): Promise<ReturnEntity> {
    const row = await this.prisma.return.create({
      data: {
        merchantId: input.merchantId,
        orderId: input.orderId,
        buyerId: input.buyerId,
        reason: input.reason as any,
        notes: input.notes,
        imageUrls: input.imageUrls ?? [],
        items: {
          create: input.items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            reason: i.reason,
          })),
        },
      },
      include: { items: true, label: true, inspection: true, refund: true },
    });
    return this.toEntity(row);
  }

  async findById(merchantId: string, returnId: string): Promise<ReturnEntity | null> {
    const row = await this.prisma.return.findFirst({
      where: { id: returnId, merchantId },
      include: { items: true, label: true, inspection: true, refund: true },
    });
    if (!row) return null;
    return this.toEntity(row);
  }

  async findByOrderId(merchantId: string, orderId: string): Promise<ReturnEntity[]> {
    const rows = await this.prisma.return.findMany({
      where: { merchantId, orderId },
      include: { items: true, label: true, inspection: true, refund: true },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async findByBuyerId(buyerId: string): Promise<ReturnEntity[]> {
    const rows = await this.prisma.return.findMany({
      where: { buyerId },
      include: { items: true, label: true, inspection: true, refund: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((r) => this.toEntity(r));
  }

  async list(input: ListReturnsInput): Promise<ListReturnsResult> {
    const limit = input.limit ?? 20;
    const where: any = { merchantId: input.merchantId };
    if (input.status) where.status = input.status;
    if (input.cursor) where.createdAt = { lt: new Date(input.cursor) };

    const [rows, total] = await Promise.all([
      this.prisma.return.findMany({
        where,
        include: { items: true, label: true, inspection: true, refund: true },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
      }),
      this.prisma.return.count({ where: { merchantId: input.merchantId, ...(input.status ? { status: input.status } : {}) } }),
    ]);

    const hasNext = rows.length > limit;
    const slice = hasNext ? rows.slice(0, limit) : rows;

    return {
      returns: slice.map((r) => this.toEntity(r)),
      nextCursor: hasNext ? slice[slice.length - 1].createdAt.toISOString() : undefined,
      total,
    };
  }

  async updateStatus(returnId: string, status: ReturnStatus): Promise<void> {
    await this.prisma.return.update({
      where: { id: returnId },
      data: { status: status as any },
    });
  }

  async saveLabel(input: SaveLabelInput): Promise<ReturnLabelProps> {
    const row = await this.prisma.returnLabel.create({
      data: {
        returnId: input.returnId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        labelUrl: input.labelUrl,
        expiresAt: input.expiresAt,
      },
    });
    return {
      id: row.id,
      returnId: row.returnId,
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      labelUrl: row.labelUrl ?? undefined,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  async saveInspection(input: SaveInspectionInput): Promise<ReturnInspectionProps> {
    const row = await this.prisma.returnInspection.create({
      data: {
        returnId: input.returnId,
        inspectedBy: input.inspectedBy,
        itemCondition: input.itemCondition as any,
        verdict: input.verdict,
        notes: input.notes,
      },
    });
    return {
      id: row.id,
      returnId: row.returnId,
      inspectedBy: row.inspectedBy,
      itemCondition: row.itemCondition as any,
      verdict: row.verdict,
      notes: row.notes ?? undefined,
      inspectedAt: row.inspectedAt,
    };
  }

  async saveRefund(input: SaveRefundInput): Promise<ReturnRefundProps> {
    const row = await this.prisma.returnRefund.create({
      data: {
        returnId: input.returnId,
        paymentIntentId: input.paymentIntentId,
        amountInCents: input.amountInCents,
        status: input.status,
      },
    });
    return {
      id: row.id,
      returnId: row.returnId,
      paymentIntentId: row.paymentIntentId ?? undefined,
      amountInCents: row.amountInCents,
      status: row.status,
      processedAt: row.processedAt ?? undefined,
      createdAt: row.createdAt,
    };
  }

  async updateRefundStatus(returnId: string, status: string, processedAt?: Date): Promise<void> {
    await this.prisma.returnRefund.update({
      where: { returnId },
      data: { status, ...(processedAt ? { processedAt } : {}) },
    });
  }

  private toEntity(row: any): ReturnEntity {
    return new ReturnEntity({
      id: row.id,
      merchantId: row.merchantId,
      orderId: row.orderId,
      buyerId: row.buyerId,
      reason: row.reason,
      notes: row.notes ?? undefined,
      imageUrls: row.imageUrls ?? [],
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items: row.items.map((i: any) => ({
        id: i.id,
        returnId: i.returnId,
        variantId: i.variantId,
        quantity: i.quantity,
        reason: i.reason ?? undefined,
      })),
      label: row.label
        ? {
            id: row.label.id,
            returnId: row.label.returnId,
            carrier: row.label.carrier,
            trackingNumber: row.label.trackingNumber,
            labelUrl: row.label.labelUrl ?? undefined,
            expiresAt: row.label.expiresAt,
            createdAt: row.label.createdAt,
          }
        : undefined,
      inspection: row.inspection
        ? {
            id: row.inspection.id,
            returnId: row.inspection.returnId,
            inspectedBy: row.inspection.inspectedBy,
            itemCondition: row.inspection.itemCondition,
            verdict: row.inspection.verdict,
            notes: row.inspection.notes ?? undefined,
            inspectedAt: row.inspection.inspectedAt,
          }
        : undefined,
      refund: row.refund
        ? {
            id: row.refund.id,
            returnId: row.refund.returnId,
            paymentIntentId: row.refund.paymentIntentId ?? undefined,
            amountInCents: row.refund.amountInCents,
            status: row.refund.status,
            processedAt: row.refund.processedAt ?? undefined,
            createdAt: row.refund.createdAt,
          }
        : undefined,
    });
  }
}
