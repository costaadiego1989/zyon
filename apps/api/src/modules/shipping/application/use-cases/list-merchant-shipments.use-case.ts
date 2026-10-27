import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface ListMerchantShipmentsInput {
  merchantId: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface ShipmentRecord {
  id: string;
  externalOrderId: string;
  carrier: string;
  status: string;
  trackingCode: string;
  createdAt: Date;
}

export interface ListMerchantShipmentsOutput {
  items: ShipmentRecord[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class ListMerchantShipmentsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: ListMerchantShipmentsInput): Promise<ListMerchantShipmentsOutput> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = {
      merchantId: input.merchantId
    };

    if (input.status) {
      where.status = input.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          externalOrderId: true,
          carrier: true,
          status: true,
          trackingCode: true,
          createdAt: true
        }
      }),
      this.prisma.shipment.count({ where })
    ]);

    return {
      items: items as ShipmentRecord[],
      total,
      page,
      pageSize
    };
  }
}
