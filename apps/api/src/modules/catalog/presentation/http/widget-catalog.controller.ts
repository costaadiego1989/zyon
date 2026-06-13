import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { AddStorefrontItemUseCase } from "../../application/add-storefront-item.use-case.js";
import { SearchStorefrontProductsUseCase } from "../../application/search-storefront-products.use-case.js";

@UseGuards(EmbedAuthGuard)
@Controller("embed/catalog")
export class WidgetCatalogController {
  constructor(
    private readonly searchProducts: SearchStorefrontProductsUseCase,
    private readonly addItem: AddStorefrontItemUseCase,
    private readonly embedGuards: EmbedCheckoutGuardHelper
  ) {}

  @Get("search")
  async search(@Req() request: EmbedHttpRequest, @Query("q") query = "", @Query("limit") limitRaw?: string) {
    const limit = Number(limitRaw ?? "8");
    const embed = request.embedClaims!;
    const products = await this.searchProducts.execute(query, Number.isFinite(limit) ? limit : 8);
    return { merchant_id: embed.merchantId, query, products };
  }

  @Post("add")
  async add(@Req() request: EmbedHttpRequest, @Body() body: { session_id?: string; sku?: string; quantity?: number }) {
    const embed = request.embedClaims!;
    const sessionId = body.session_id?.trim();
    const sku = body.sku?.trim();
    if (!sessionId || !sku) throw new BadRequestException("catalog_add_payload_required");
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, sessionId);
    return this.addItem.execute({
      merchant_id: embed.merchantId,
      session_id: sessionId,
      sku,
      quantity: body.quantity
    });
  }
}
