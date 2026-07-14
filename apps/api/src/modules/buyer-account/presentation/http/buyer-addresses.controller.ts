import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ulid } from "ulid";
import type { BuyerAddress } from "../../domain/entities/buyer-address.entity.js";
import { ListBuyerAddressesUseCase } from "../../application/use-cases/list-buyer-addresses.use-case.js";
import { AddBuyerAddressUseCase } from "../../application/use-cases/list-buyer-addresses.use-case.js";
import { UpdateBuyerAddressUseCase } from "../../application/use-cases/list-buyer-addresses.use-case.js";
import { DeleteBuyerAddressUseCase } from "../../application/use-cases/list-buyer-addresses.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";

function toDto(addr: BuyerAddress) {
  return {
    id: addr.id,
    zip: addr.zipFormatted,
    street: addr.street,
    number: addr.number,
    complement: addr.complement ?? null,
    neighborhood: addr.neighborhood,
    city: addr.city,
    state: addr.state,
    is_default: addr.isDefault,
    created_at: addr.createdAt.toISOString(),
  };
}

@Controller("buyer/me/addresses")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerAddressesController {
  constructor(
    private readonly listAddresses: ListBuyerAddressesUseCase,
    private readonly addAddress: AddBuyerAddressUseCase,
    private readonly updateAddress: UpdateBuyerAddressUseCase,
    private readonly deleteAddress: DeleteBuyerAddressUseCase
  ) {}

  @Get()
  async list(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    const addresses = await this.listAddresses.execute(buyer.globalUserId);
    return {
      items: addresses.map(toDto),
    };
  }

  @Post()
  async add(
    @Req() req: { user?: unknown },
    @Body()
    body: {
      zip: string;
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
      city: string;
      state: string;
      is_default?: boolean;
    }
  ) {
    const buyer = currentBuyer(req);
    const crypto = await import("crypto");
    const addr = await this.addAddress.execute({
      globalUserId: buyer.globalUserId,
      id: crypto.randomUUID(),
      zip: body.zip,
      street: body.street,
      number: body.number,
      complement: body.complement,
      neighborhood: body.neighborhood,
      city: body.city,
      state: body.state,
      isDefault: body.is_default ?? false,
    });
    return toDto(addr);
  }

  @Put(":id")
  async update(
    @Req() req: { user?: unknown },
    @Param("id") id: string,
    @Body()
    body: {
      zip?: string;
      street?: string;
      number?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      is_default?: boolean;
    }
  ) {
    const buyer = currentBuyer(req);
    const addr = await this.updateAddress.execute({
      globalUserId: buyer.globalUserId,
      id,
      zip: body.zip,
      street: body.street,
      number: body.number,
      complement: body.complement,
      neighborhood: body.neighborhood,
      city: body.city,
      state: body.state,
      isDefault: body.is_default,
    });
    return toDto(addr);
  }

  @Delete(":id")
  async delete(@Req() req: { user?: unknown }, @Param("id") id: string) {
    const buyer = currentBuyer(req);
    await this.deleteAddress.execute({
      globalUserId: buyer.globalUserId,
      id,
    });
    return { success: true };
  }
}
