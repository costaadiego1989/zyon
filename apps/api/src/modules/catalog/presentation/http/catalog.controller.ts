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
