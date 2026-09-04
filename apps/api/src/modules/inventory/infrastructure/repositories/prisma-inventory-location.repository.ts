import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { INVENTORY_LOCATION_REPOSITORY, type InventoryLocationRepositoryPort, type LocationRow } from "../../domain/ports/inventory-location-repository.port.js";

@Injectable()
export class PrismaInventoryLocationRepository implements InventoryLocationRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async list(merchantId: string): Promise<LocationRow[]> {
    const locations = await this.prisma.inventoryLocation.findMany({
      where: { merchantId },
      orderBy: { isDefault: "desc" },
    });

    return locations.map((l) => ({
      id: l.id,
      merchantId: l.merchantId,
      name: l.name,
      kind: l.kind,
      isDefault: l.isDefault,
      isActive: l.isActive,
    }));
  }

  async create(
    merchantId: string,
    data: { name: string; kind?: string; isDefault?: boolean },
  ): Promise<LocationRow> {
    const location = await this.prisma.inventoryLocation.create({
      data: {
        merchantId,
        name: data.name,
        kind: data.kind ?? "warehouse",
        isDefault: data.isDefault ?? false,
      },
    });

    return {
      id: location.id,
      merchantId: location.merchantId,
      name: location.name,
      kind: location.kind,
      isDefault: location.isDefault,
      isActive: location.isActive,
    };
  }

  async update(
    merchantId: string,
    id: string,
    data: { name?: string; kind?: string; isActive?: boolean },
  ): Promise<LocationRow> {
    const location = await this.prisma.inventoryLocation.update({
      where: { id },
      data: {
        name: data.name,
        kind: data.kind,
        isActive: data.isActive,
      },
    });

    return {
      id: location.id,
      merchantId: location.merchantId,
      name: location.name,
      kind: location.kind,
      isDefault: location.isDefault,
      isActive: location.isActive,
    };
  }

  async getDefault(merchantId: string): Promise<LocationRow | null> {
    const location = await this.prisma.inventoryLocation.findFirst({
      where: { merchantId, isDefault: true },
    });

    if (!location) return null;

    return {
      id: location.id,
      merchantId: location.merchantId,
      name: location.name,
      kind: location.kind,
      isDefault: location.isDefault,
      isActive: location.isActive,
    };
  }
}
