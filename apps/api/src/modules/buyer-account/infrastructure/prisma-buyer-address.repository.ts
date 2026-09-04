import type { PrismaClient } from "@prisma/client";
import {
  BuyerAddress,
  type BuyerAddressProps,
} from "../domain/entities/buyer-address.entity.js";
import type { BuyerAddressRepository } from "../domain/ports/buyer-address.port.js";

type AddressRow = {
  id: string;
  globalUserId: string;
  zip: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export class PrismaBuyerAddressRepository implements BuyerAddressRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(globalUserId: string): Promise<BuyerAddress[]> {
    const rows = await (this.prisma.buyerAddress as unknown as {
      findMany: (args: { where: { globalUserId: string } }) => Promise<AddressRow[]>;
    }).findMany({ where: { globalUserId } });
    return rows.map(toDomain);
  }

  async findById(globalUserId: string, id: string): Promise<BuyerAddress | null> {
    const row = await (this.prisma.buyerAddress as unknown as {
      findFirst: (args: { where: { id: string; globalUserId: string } }) => Promise<AddressRow | null>;
    }).findFirst({ where: { id, globalUserId } });
    return row ? toDomain(row) : null;
  }

  async save(address: BuyerAddress): Promise<void> {
    const data = {
      globalUserId: address.globalUserId,
      zip: address.zip,
      street: address.street,
      number: address.number,
      complement: address.complement ?? null,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      isDefault: address.isDefault,
    };
    await (this.prisma.buyerAddress as unknown as {
      upsert: (args: {
        where: { id: string };
        create: typeof data & { id: string };
        update: Partial<typeof data>;
      }) => Promise<unknown>;
    }).upsert({
      where: { id: address.id },
      create: { id: address.id, ...data },
      update: data,
    });
  }

  async delete(globalUserId: string, id: string): Promise<void> {
    await (this.prisma.buyerAddress as unknown as {
      deleteMany: (args: { where: { id: string; globalUserId: string } }) => Promise<unknown>;
    }).deleteMany({ where: { id, globalUserId } });
  }

  async count(globalUserId: string): Promise<number> {
    return (this.prisma.buyerAddress as unknown as {
      count: (args: { where: { globalUserId: string } }) => Promise<number>;
    }).count({ where: { globalUserId } });
  }

  async clearDefaults(globalUserId: string): Promise<void> {
    await (this.prisma.buyerAddress as unknown as {
      updateMany: (args: {
        where: { globalUserId: string; isDefault: boolean };
        data: { isDefault: boolean };
      }) => Promise<unknown>;
    }).updateMany({
      where: { globalUserId, isDefault: true },
      data: { isDefault: false },
    });
  }
}

function toDomain(row: AddressRow): BuyerAddress {
  const props: BuyerAddressProps = {
    id: row.id,
    globalUserId: row.globalUserId,
    zip: row.zip,
    zipFormatted: formatCep(row.zip),
    street: row.street,
    number: row.number,
    complement: row.complement ?? undefined,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  };
  return new BuyerAddress(props);
}

function formatCep(digits: string): string {
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}