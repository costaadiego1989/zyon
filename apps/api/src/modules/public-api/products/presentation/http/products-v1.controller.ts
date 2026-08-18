import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { AddProductUseCase } from '../../../../catalog/application/use-cases/add-product.use-case.js';
import { SearchProductsUseCase } from '../../../../catalog/application/use-cases/search-products.use-case.js';
import { GetProductUseCase } from '../../../../catalog/application/use-cases/get-product.use-case.js';
import { UpdateProductUseCase } from '../../../../catalog/application/use-cases/update-product.use-case.js';
import { DeleteProductUseCase } from '../../../../catalog/application/use-cases/delete-product.use-case.js';
import { ProductEntityMapper } from '../../application/mappers/product-entity.mapper.js';
import { CreateProductDto, UpdateProductDto } from './dtos/product.dtos.js';

/**
 * Public API v1 — Products
 *
 * RESTful resource controller for product catalog.
 * Delegates to existing CatalogModule use-cases.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by global TenantGuard + TenantInterceptor.
 *
 * Note: catalog:write scope does not exist yet — writes are gated
 * to human principals (console owners/admins) only.
 */
@ApiTags('Products')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('products')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class ProductsV1Controller {
  constructor(
    private readonly addProductUseCase: AddProductUseCase,
    private readonly searchProductsUseCase: SearchProductsUseCase,
    private readonly getProductUseCase: GetProductUseCase,
    private readonly updateProductUseCase: UpdateProductUseCase,
    private readonly deleteProductUseCase: DeleteProductUseCase,
  ) {}

  /**
   * GET /v1/products
   * List products with cursor-based pagination and search.
   */
  @Get()
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'List or search products' })
  @ApiQuery({ name: 'limit', type: 'number', required: false, example: 20 })
  @ApiQuery({ name: 'cursor', type: 'string', required: false })
  @ApiQuery({ name: 'query', type: 'string', required: false })
  @ApiQuery({ name: 'category_id', type: 'string', required: false })
  @ApiOkResponse({ description: 'Products list' })
  async list(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
    @Query('query') query?: string,
    @Query('category_id') categoryId?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const pageSize = Math.min(limit ?? 20, 100);

    const result = await this.searchProductsUseCase.execute({
      merchantId,
      query,
      categoryId,
      limit: pageSize,
      cursor,
    });

    return {
      data: result.products.map((p: any) => ProductEntityMapper.toProductSummaryResponse(p)),
      pagination: {
        next_cursor: result.nextCursor ?? null,
        has_more: result.nextCursor != null,
      },
    };
  }

  /**
   * GET /v1/products/:productId
   * Get a single product with full details.
   */
  @Get(':productId')
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Get product details' })
  @ApiOkResponse({ description: 'Product details' })
  async get(@Req() req: any, @Param('productId') productId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const product = await this.getProductUseCase.execute(merchantId, productId);
    return ProductEntityMapper.toProductDetailResponse(product);
  }

  /**
   * POST /v1/products
   * Create a new product.
   */
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Create a product' })
  @ApiCreatedResponse({ description: 'Product created' })
  async create(@Req() req: any, @Body() body: CreateProductDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.addProductUseCase.execute({
      merchantId,
      name: body.name,
      description: body.description,
      type: body.type,
      categoryId: body.category_id,
      metadata: body.metadata,
      seoTitle: body.seo_title,
      metaDescription: body.meta_description,
      slug: body.slug,
      ogTitle: body.og_title,
      ogDescription: body.og_description,
      twitterCard: body.twitter_card,
      keywords: body.keywords,
      variants: body.variants.map((v) => ({
        sku: v.sku,
        attributes: v.attributes ?? {},
        barcode: v.barcode,
        weightGrams: v.weight_grams,
        lengthCm: v.length_cm,
        widthCm: v.width_cm,
        heightCm: v.height_cm,
        basePriceInCents: v.base_price_in_cents,
        costInCents: v.cost_in_cents,
        taxPercent: v.tax_percent,
        currency: v.currency,
        stockQuantity: v.stock_quantity,
        media: v.media,
      })),
    });
    return ProductEntityMapper.toProductDetailResponse(result);
  }

  /**
   * PATCH /v1/products/:productId
   * Update an existing product.
   */
  @Patch(':productId')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Update a product' })
  @ApiOkResponse({ description: 'Product updated' })
  async update(
    @Req() req: any,
    @Param('productId') productId: string,
    @Body() body: UpdateProductDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.updateProductUseCase.execute({
      merchantId,
      productId,
      name: body.name,
      description: body.description,
      type: body.type,
      categoryId: body.category_id,
      metadata: body.metadata,
      isActive: body.is_active,
      seoTitle: body.seo_title,
      metaDescription: body.meta_description,
      slug: body.slug,
      ogTitle: body.og_title,
      ogDescription: body.og_description,
      twitterCard: body.twitter_card,
      keywords: body.keywords,
    });
    return ProductEntityMapper.toProductDetailResponse(result);
  }

  /**
   * DELETE /v1/products/:productId
   * Delete a product.
   */
  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Delete a product' })
  @ApiOkResponse({ description: 'Product deleted' })
  async remove(@Req() req: any, @Param('productId') productId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.deleteProductUseCase.execute(merchantId, productId);
    return { deleted: true, product_id: productId };
  }
}
