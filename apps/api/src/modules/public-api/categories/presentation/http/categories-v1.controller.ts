import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Param,
  Body,
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
  ApiBody,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { ListCategoriesUseCase } from '../../../../catalog/application/use-cases/list-categories.use-case.js';
import { CreateCategoryUseCase } from '../../../../catalog/application/use-cases/create-category.use-case.js';
import { UpdateCategoryUseCase } from '../../../../catalog/application/use-cases/update-category.use-case.js';
import { DeleteCategoryUseCase } from '../../../../catalog/application/use-cases/delete-category.use-case.js';
import { ReorderCategoriesUseCase } from '../../../../catalog/application/use-cases/reorder-categories.use-case.js';

import { CategoryEntityMapper } from '../../application/mappers/category-entity.mapper.js';
import { CreateCategoryDto, UpdateCategoryDto, ReorderCategoryDto } from './dtos/category.dtos.js';
import { CategoryResponse } from './dtos/category-response.dto.js';

@ApiTags('Categories')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('categories')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class CategoriesV1Controller {
  constructor(
    private readonly listCategoriesUseCase: ListCategoriesUseCase,
    private readonly createCategoryUseCase: CreateCategoryUseCase,
    private readonly updateCategoryUseCase: UpdateCategoryUseCase,
    private readonly deleteCategoryUseCase: DeleteCategoryUseCase,
    private readonly reorderCategoriesUseCase: ReorderCategoriesUseCase,
  ) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'List all categories' })
  @ApiOkResponse({ description: 'Categories list', type: [CategoryResponse] })
  async list(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const categories = await this.listCategoriesUseCase.execute(merchantId);
    return {
      data: categories.map((c: any) => CategoryEntityMapper.toResponseDetail(c)),
    };
  }

  @Get(':categoryId')
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Get category details' })
  @ApiOkResponse({ description: 'Category details', type: CategoryResponse })
  async get(@Req() req: any, @Param('categoryId') categoryId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const categories = await this.listCategoriesUseCase.execute(merchantId);
    const category = categories.find((c: any) => c.id === categoryId);
    if (!category) {
      throw new Error('category_not_found');
    }
    return CategoryEntityMapper.toResponseDetail(category);
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Create a category' })
  @ApiBody({ type: CreateCategoryDto })
  @ApiCreatedResponse({ description: 'Category created', type: CategoryResponse })
  async create(@Req() req: any, @Body() body: CreateCategoryDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.createCategoryUseCase.execute(merchantId, {
      name: body.name,
      description: body.description,
      parentId: body.parent_id,
      imageUrl: body.image_url,
      slug: body.slug,
    });
    return CategoryEntityMapper.toResponseDetail(result);
  }

  @Patch(':categoryId')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Update a category' })
  @ApiBody({ type: UpdateCategoryDto })
  @ApiOkResponse({ description: 'Category updated', type: CategoryResponse })
  async update(
    @Req() req: any,
    @Param('categoryId') categoryId: string,
    @Body() body: UpdateCategoryDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.updateCategoryUseCase.execute(merchantId, categoryId, {
      name: body.name,
      description: body.description,
      parentId: body.parent_id,
      imageUrl: body.image_url,
      isActive: body.is_active,
      sortOrder: body.sort_order,
    });
    return CategoryEntityMapper.toResponseDetail(result);
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Delete a category' })
  @ApiOkResponse({ description: 'Category deleted' })
  async remove(@Req() req: any, @Param('categoryId') categoryId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.deleteCategoryUseCase.execute(merchantId, categoryId);
    return { deleted: true, category_id: categoryId };
  }

  @Put('reorder')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['catalog:read'] })
  @ApiOperation({ summary: 'Reorder categories' })
  @ApiBody({ type: ReorderCategoryDto })
  @ApiOkResponse({ description: 'Categories reordered' })
  async reorder(@Req() req: any, @Body() body: ReorderCategoryDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.reorderCategoriesUseCase.execute(
      merchantId,
      body.category_orders.map((order) => ({
        id: order.category_id,
        sort_order: order.position,
      })),
    );
    return { reordered: true };
  }
}
