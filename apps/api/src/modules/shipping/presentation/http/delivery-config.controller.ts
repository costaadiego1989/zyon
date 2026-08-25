import { Body, Controller, Get, Put, Req, UseGuards, Param } from "@nestjs/common";
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
import { PurchaseShippingLabelUseCase } from "../../application/use-cases/shipping-label.use-cases.js";

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
    private readonly purchaseLabelUseCase: PurchaseShippingLabelUseCase
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
    @Param("status") status?: string
  ) {
    return this.listShipmentsUseCase.execute({
      merchantId: tenantId(request),
      status,
      page: 1,
      pageSize: 20
    });
  }

  @ApiOperation({
    summary: "Purchase shipping label",
    description: "Purchase a shipping label for an order via the configured carrier"
  })
  @ApiResponse({
    status: 201,
    description: "Label purchased",
    schema: {
      example: {
        id: "shipment_123",
        tracking_code: "BR123456789",
        label_url: "https://...",
        carrier: "correios",
        status: "created"
      }
    }
  })
  @Put("shipments/:shipmentId/label")
  @RequireTenantAccess({ serviceScopes: ["orders:write"] })
  async purchaseLabel(
    @Req() request: unknown,
    @Param("shipmentId") shipmentId: string,
    @Body() body: PurchaseLabelDto
  ) {
    return this.purchaseLabelUseCase.execute({
      merchantId: tenantId(request),
      externalOrderId: body.order_id,
      serviceId: body.service_id,
      fromZip: body.from_zip,
      toZip: body.to_zip,
      toName: body.to_name,
      toDocument: body.to_document,
      packages: body.packages,
      invoiceKey: body.invoice_key
    });
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(request as Parameters<typeof currentTenantPrincipal>[0]).tenantId;
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

export type PurchaseLabelDto = {
  order_id: string;
  service_id: number;
  from_zip: string;
  to_zip: string;
  to_name: string;
  to_document: string;
  packages: Array<{ weightKg: number; widthCm: number; heightCm: number; lengthCm: number; quantity: number }>;
  invoice_key?: string;
};
