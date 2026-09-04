import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
} from "@nestjs/swagger";

import { ResponseEnvelopeInterceptor } from "../../../../../shared/http/response-envelope.interceptor.js";
import { Idempotent } from "../../../../../shared/http/idempotency/idempotent.decorator.js";
import { TenantCredentialGuard } from "../../../../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../../../../integrations/presentation/http/tenant-access.guard.js";
import { RequireTenantAccess } from "../../../../integrations/presentation/http/tenant-access.decorator.js";

import { SearchFederatedProductsUseCase } from "../../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import { AddCrossStoreItemUseCase } from "../../../../marketplace/application/use-cases/add-cross-store-item.use-case.js";
import { PlaceCrossStoreOrderUseCase } from "../../../../marketplace/application/use-cases/place-cross-store-order.use-case.js";
import { UpdateMarketplaceConfigUseCase } from "../../../../marketplace/application/use-cases/update-marketplace-config.use-case.js";
import { GetSellerOrdersUseCase } from "../../../../marketplace/application/use-cases/get-seller-orders.use-case.js";
import { HandleMarketplaceChargebackUseCase } from "../../../../marketplace/application/use-cases/handle-marketplace-chargeback.use-case.js";
import { MarketplaceEntityMapper } from "../../../../marketplace/application/mappers/marketplace-entity.mapper.js";
import {
  SearchMarketplaceDto,
  UpdateMarketplaceConfigDto,
  AddCrossStoreItemDto,
  PlaceCrossStoreOrderDto,
  HandleChargebackDto,
} from "./dtos/marketplace.dtos.js";

@ApiTags("Marketplace")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@Controller("marketplace")
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class MarketplaceV1Controller {
  constructor(
    private readonly searchUseCase: SearchFederatedProductsUseCase,
    private readonly addItemUseCase: AddCrossStoreItemUseCase,
    private readonly placeOrderUseCase: PlaceCrossStoreOrderUseCase,
    private readonly configUseCase: UpdateMarketplaceConfigUseCase,
    private readonly getSellerOrdersUseCase: GetSellerOrdersUseCase,
    private readonly chargebackUseCase: HandleMarketplaceChargebackUseCase,
  ) {}

  @Get("search")
  @RequireTenantAccess({ serviceScopes: ["marketplace:read"] })
  @ApiOperation({ summary: "Search federated products" })
  @ApiOkResponse({ description: "Products found" })
  async search(@Req() req: any, @Query() query: SearchMarketplaceDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.searchUseCase.execute({
      hostMerchantId: merchantId,
      query: query.query,
      category: query.category,
      limit: query.limit ?? 20,
    });
    return {
      products: result.products.map((p) =>
        MarketplaceEntityMapper.toProductResponse(p),
      ),
    };
  }

  @Get("config")
  @RequireTenantAccess({ serviceScopes: ["marketplace:read"] })
  @ApiOperation({ summary: "Get marketplace configuration" })
  @ApiOkResponse({ description: "Configuration retrieved" })
  async getConfig(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.configUseCase.execute({
      merchantId,
    });
    return MarketplaceEntityMapper.toConfigResponse(result.config);
  }

  @Patch("config")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["marketplace:write"] })
  @ApiOperation({ summary: "Update marketplace configuration" })
  @ApiOkResponse({ description: "Configuration updated" })
  async updateConfig(
    @Req() req: any,
    @Body() body: UpdateMarketplaceConfigDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.configUseCase.execute({
      merchantId,
      enabled: body.enabled,
      commissionRateBps: body.commission_rate_bps,
      returnWindowDays: body.return_window_days,
      payoutDelayDays: body.payout_delay_days,
      chargebackWindowDays: body.chargeback_window_days,
      allowedCategories: body.allowed_categories,
      blockedMerchants: body.blocked_merchants,
    });
    return MarketplaceEntityMapper.toConfigResponse(result.config);
  }

  @Post("items")
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ["marketplace:write"] })
  @ApiOperation({ summary: "Add cross-store item to checkout" })
  @ApiCreatedResponse({ description: "Item added" })
  async addItem(@Req() req: any, @Body() body: AddCrossStoreItemDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.addItemUseCase.execute({
      checkoutSessionId: body.checkout_session_id,
      hostMerchantId: merchantId,
      sellerMerchantId: body.seller_merchant_id,
      federatedProductId: body.federated_product_id,
      quantity: body.quantity,
      unitPriceCents: body.unit_price_cents,
    });
    return MarketplaceEntityMapper.toLineItemResponse(result.lineItem);
  }

  @Post("orders")
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ["marketplace:write"] })
  @ApiOperation({ summary: "Place cross-store order" })
  @ApiCreatedResponse({ description: "Order placed" })
  async placeOrder(
    @Req() req: any,
    @Body() body: PlaceCrossStoreOrderDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.placeOrderUseCase.execute({
      checkoutSessionId: body.checkout_session_id,
      orderId: body.order_id,
      hostMerchantId: merchantId,
    });
    return {
      settlements: result.settlements.map((s) =>
        MarketplaceEntityMapper.toSettlementResponse(s),
      ),
    };
  }

  @Get("orders")
  @RequireTenantAccess({ serviceScopes: ["marketplace:read"] })
  @ApiOperation({ summary: "List seller orders" })
  @ApiOkResponse({ description: "Orders listed" })
  async getOrders(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.getSellerOrdersUseCase.execute({
      sellerMerchantId: merchantId,
    });
    return {
      orders: result.orders.map((o) =>
        MarketplaceEntityMapper.toLineItemResponse(o),
      ),
    };
  }

  @Post("chargebacks")
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ["marketplace:write"] })
  @ApiOperation({ summary: "Handle settlement chargeback" })
  @ApiOkResponse({ description: "Chargeback processed" })
  async handleChargeback(@Req() req: any, @Body() body: HandleChargebackDto) {
    const result = await this.chargebackUseCase.execute({
      settlementId: body.settlement_id,
    });
    return MarketplaceEntityMapper.toSettlementResponse(result.settlement);
  }
}
