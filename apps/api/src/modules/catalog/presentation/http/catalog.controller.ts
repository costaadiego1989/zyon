import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import {
  RequireTenantAccess,
} from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import {
  COMMERCE_CATALOG_PORT,
  type CommerceCatalogReader,
} from "../../../commerce/domain/ports/commerce-catalog.port.js";

@ApiTags("Catalog")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({ serviceScopes: ["catalog:read"] })
@Controller("catalog")
export class CatalogController {
  constructor(
    @Inject(COMMERCE_CATALOG_PORT)
    private readonly catalog: CommerceCatalogReader,
  ) {}

  @ApiOperation({
    summary: "Search product catalog",
    description:
      "Search the merchant product catalog with optional text query. Supports cursor-based pagination with configurable limit (1-100, default 20).",
  })
  @ApiResponse({
    status: 200,
    description: "Paginated product list",
    schema: {
      example: {
        data: [
          {
            id: "prod_123",
            title: "Widget",
            description: null,
            product_url: null,
            image_url: null,
            category: null,
            variants: [
              {
                id: "var_1",
                sku: "WDG-001",
                title: "Default",
                unit_price: 2999,
                currency: "BRL",
                inventory_quantity: 50,
                available_for_sale: true,
                image_url: null,
              },
            ],
          },
        ],
        next_cursor: "cursor_abc",
        has_more: true,
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Missing catalog:read scope",
  })
  @Get()
  async search(
    @Req() request: unknown,
    @Query("q") query = "",
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursor?: string,
  ) {
    const limit = clampLimit(limitRaw);
    const page = await this.catalog.searchCatalog({
      merchantId: tenantId(request),
      query,
      limit,
      cursor,
    });
    return {
      data: page.products.map(toProductResponse),
      next_cursor: page.nextCursor,
      has_more: page.nextCursor !== null,
    };
  }

  @ApiOperation({
    summary: "Get product by SKU",
    description:
      "Look up a single product by its SKU. Returns null data if no product matches.",
  })
  @ApiResponse({
    status: 200,
    description: "Product found or null",
    schema: {
      example: {
        data: {
          id: "prod_123",
          title: "Widget",
          variants: [],
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Missing catalog:read scope",
  })
  @Get(":sku")
  async bySku(
    @Req() request: unknown,
    @Param("sku") sku: string,
  ) {
    const product = await this.catalog.findCatalogProductBySku({
      merchantId: tenantId(request),
      sku,
    });
    return { data: product ? toProductResponse(product) : null };
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}

function clampLimit(value?: string): number {
  const parsed = Number(value ?? 20);
  return Number.isInteger(parsed)
    ? Math.max(1, Math.min(parsed, 100))
    : 20;
}

function toProductResponse(product: {
  id: string;
  title: string;
  description?: string;
  productUrl?: string;
  imageUrl?: string;
  category?: string;
  variants: Array<{
    id: string;
    sku: string;
    title: string;
    unitPriceCents: number;
    currency: string;
    inventoryQuantity: number | null;
    availableForSale: boolean;
    imageUrl?: string;
  }>;
}) {
  return {
    id: product.id,
    title: product.title,
    description: product.description ?? null,
    product_url: product.productUrl ?? null,
    image_url: product.imageUrl ?? null,
    category: product.category ?? null,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      unit_price: variant.unitPriceCents,
      currency: variant.currency,
      inventory_quantity: variant.inventoryQuantity,
      available_for_sale: variant.availableForSale,
      image_url: variant.imageUrl ?? null,
    })),
  };
}
