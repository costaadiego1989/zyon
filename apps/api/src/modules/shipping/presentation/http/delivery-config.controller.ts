import { Body, Controller, Get, Put, Req, UseGuards, Query, Post } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { GetDeliveryConfigUseCase } from "../../application/use-cases/get-delivery-config.use-case.js";
import { UpdateDeliveryConfigUseCase } from "../../application/use-cases/update-delivery-config.use-case.js";
import { ListMerchantShipmentsUseCase } from "../../application/use-cases/list-merchant-shipments.use-case.js";
import { QuoteRadiusDeliveryUseCase } from "../../application/use-cases/quote-radius-delivery.use-case.js";

@ApiTags("Delivery config")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller("merchants/me/delivery")
export class DeliveryConfigController {
  constructor(
    private readonly getDeliveryConfig: GetDeliveryConfigUseCase,
    private readonly updateDeliveryConfig: UpdateDeliveryConfigUseCase,
    private readonly listShipmentsUseCase: ListMerchantShipmentsUseCase,
    private readonly quoteRadiusDelivery: QuoteRadiusDeliveryUseCase
  ) {}

  @ApiOperation({
    summary: "Get delivery configuration",
    description: "Retrieve merchant delivery settings: Melhor Envio status and own-delivery config"
  })
  @ApiResponse({
    status: 200,
    description: "Delivery config retrieved",
    schema: {
      example: {
        melhorEnvioEnabled: true,
        melhorEnvioConnected: true,
        ownDelivery: {
          enabled: false,
          mode: "flat",
          flatPriceCents: null,
          freeAboveCents: null,
          neighborhoods: null,
          estimatedValue: 60,
          estimatedUnit: "minutes"
        }
      }
    }
  })
  @Get("config")
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  async getConfig(@Req() request: unknown) {
    return this.getDeliveryConfig.execute({
      merchantId: tenantId(request)
    });
  }

  @ApiOperation({
    summary: "Update delivery configuration",
    description: "Update Melhor Envio enabled flag and/or own-delivery settings"
  })
  @ApiResponse({
    status: 200,
    description: "Delivery config updated",
    schema: { example: { success: true } }
  })
  @Put("config")
  @RequireTenantAccess({ serviceScopes: ["orders:write"] })
  async updateConfig(@Req() request: unknown, @Body() body: UpdateDeliveryConfigDto) {
    return this.updateDeliveryConfig.execute({
      merchantId: tenantId(request),
      melhorEnvioEnabled: body.melhor_envio_enabled,
      ownDelivery: body.own_delivery ? {
        enabled: body.own_delivery.enabled,
        mode: body.own_delivery.mode,
        flatPriceCents: body.own_delivery.flat_price_cents,
        freeAboveCents: body.own_delivery.free_above_cents,
        neighborhoods: body.own_delivery.neighborhoods,
        radiusZones: body.own_delivery.radius_zones?.map((z) => ({
          maxKm: z.max_km,
          priceCents: z.price_cents
        })),
        estimatedValue: body.own_delivery.estimated_value,
        estimatedUnit: body.own_delivery.estimated_unit
      } : undefined
    });
  }

  @ApiOperation({
    summary: "List merchant shipments",
    description: "Retrieve paginated list of shipments for merchant, optionally filtered by status"
  })
  @ApiResponse({
    status: 200,
    description: "Shipments retrieved",
    schema: {
      example: {
        items: [
          {
            id: "shipment_123",
            externalOrderId: "order_456",
            carrier: "correios",
            status: "created",
            trackingCode: "BR123456789",
            createdAt: "2026-08-24T12:00:00Z"
          }
        ],
        total: 10,
        page: 1,
        pageSize: 20
      }
    }
  })
  @Get("shipments")
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  async listShipments(
    @Req() request: unknown,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    return this.listShipmentsUseCase.execute({
      merchantId: tenantId(request),
      status: status?.trim() || undefined,
      page: parsePositiveInteger(page, 1, 100_000),
      pageSize: parsePositiveInteger(pageSize, 20, 100),
    });
  }

  @ApiOperation({
    summary: "Quote radius delivery pricing",
    description: "Calculate delivery price based on distance for radius-based pricing mode"
  })
  @ApiResponse({
    status: 200,
    description: "Quote calculated",
    schema: {
      example: {
        distanceKm: 5.2,
        priceCents: 1500,
        zone: {
          maxKm: 5,
          label: "Até 5 km"
        }
      }
    }
  })
  @Post("quote-radius")
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  async quoteRadius(@Req() request: unknown, @Body() body: QuoteRadiusDeliveryDto) {
    return this.quoteRadiusDelivery.execute({
      merchantId: tenantId(request),
      destinationCep: body.destination_cep,
      originCep: body.origin_cep
    });
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(request as Parameters<typeof currentTenantPrincipal>[0]).tenantId;
}

function parsePositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export type UpdateDeliveryConfigDto = {
  melhor_envio_enabled?: boolean;
  own_delivery?: {
    enabled: boolean;
    mode?: "flat" | "neighborhood" | "radius";
    flat_price_cents?: number | null;
    free_above_cents?: number | null;
    neighborhoods?: Array<{ name: string; priceCents: number }> | null;
    radius_zones?: Array<{ max_km: number | null; price_cents: number }> | null;
    estimated_value?: number;
    estimated_unit?: "minutes" | "days";
  };
};

export type QuoteRadiusDeliveryDto = {
  destination_cep: string;
  origin_cep: string;
};
