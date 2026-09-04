import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiBody,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { CreateCouponUseCase } from '../../../../coupons/application/use-cases/create-coupon.use-case.js';
import { ArchiveCouponUseCase } from '../../../../coupons/application/use-cases/archive-coupon.use-case.js';
import { ApplyCouponUseCase } from '../../../../coupons/application/use-cases/apply-coupon.use-case.js';
import { COUPON_REPOSITORY, type CouponRepository } from '../../../../coupons/domain/ports/coupon-repository.port.js';

import {
  CreateCouponDto,
  UpdateCouponDto,
  ValidateCouponDto,
  CouponResponse,
  CouponValidationResponse,
} from './dtos/coupon.dtos.js';
import { CouponEntityMapper } from '../../application/mappers/coupon-entity.mapper.js';

@ApiTags('Coupons')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('coupons')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class CouponsV1Controller {
  constructor(
    private readonly createCouponUseCase: CreateCouponUseCase,
    private readonly archiveCouponUseCase: ArchiveCouponUseCase,
    private readonly applyCouponUseCase: ApplyCouponUseCase,
    @Inject(COUPON_REPOSITORY) private readonly couponRepo: CouponRepository,
  ) {}

  /**
   * GET /v1/coupons
   * List all coupons for the merchant.
   */
  @Get()
  @RequireTenantAccess({ serviceScopes: ['coupons:read'] })
  @ApiOperation({ summary: 'List coupons' })
  @ApiOkResponse({ description: 'Coupons retrieved', type: [CouponResponse] })
  async list(@Req() req: any): Promise<CouponResponse[]> {
    const merchantId = req.tenantPrincipal?.tenantId;
    const coupons = await this.couponRepo.findAllByMerchant(merchantId);
    return coupons.map((c) => CouponEntityMapper.toResponse(c.snapshot()));
  }

  /**
   * POST /v1/coupons
   * Create a new coupon.
   */
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['coupons:write'] })
  @ApiOperation({ summary: 'Create a coupon' })
  @ApiBody({ type: CreateCouponDto })
  @ApiCreatedResponse({ description: 'Coupon created', type: CouponResponse })
  @ApiBadRequestResponse({ description: 'Invalid coupon data' })
  async create(@Req() req: any, @Body() body: CreateCouponDto): Promise<CouponResponse> {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.createCouponUseCase.execute({
      merchant_id: merchantId,
      code: body.code,
      discount_type: body.discount_type as any,
      discount_value: body.discount_value,
      min_cart_total: body.min_cart_total,
      max_usages: body.max_usages,
      max_per_buyer: body.max_per_buyer,
      allowed_skus: body.allowed_skus,
      blocked_skus: body.blocked_skus,
      allowed_regions: body.allowed_regions,
      blocked_regions: body.blocked_regions,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
    });
    return CouponEntityMapper.toResponse(result);
  }

  /**
   * PATCH /v1/coupons/:id
   * Archive or update a coupon.
   */
  @Patch(':id')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['coupons:write'] })
  @ApiOperation({ summary: 'Archive or update a coupon' })
  @ApiBody({ type: UpdateCouponDto })
  @ApiOkResponse({ description: 'Coupon updated', type: CouponResponse })
  @ApiNotFoundResponse({ description: 'Coupon not found' })
  async update(
    @Req() req: any,
    @Param('id') couponId: string,
    @Body() body: UpdateCouponDto,
  ): Promise<CouponResponse> {
    const merchantId = req.tenantPrincipal?.tenantId;

    // For now, PATCH only supports archiving via a status field or direct archive.
    // If all fields are empty, treat as archive request.
    const hasUpdates = Object.values(body).some((v) => v !== undefined);
    if (!hasUpdates) {
      // Archive
      const result = await this.archiveCouponUseCase.execute({
        id: couponId,
        merchant_id: merchantId,
      });
      return CouponEntityMapper.toResponse(result);
    }

    // Otherwise, reject — no update use-case yet
    throw new BadRequestException(
      'Updates not yet supported. Use archive flow instead.',
    );
  }

  /**
   * DELETE /v1/coupons/:id
   * Archive a coupon.
   */
  @Delete(':id')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['coupons:write'] })
  @ApiOperation({ summary: 'Archive a coupon' })
  @ApiOkResponse({ description: 'Coupon archived' })
  @ApiNotFoundResponse({ description: 'Coupon not found' })
  async remove(@Req() req: any, @Param('id') couponId: string): Promise<{ archived: true; coupon_id: string }> {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.archiveCouponUseCase.execute({
      id: couponId,
      merchant_id: merchantId,
    });
    return { archived: true, coupon_id: couponId };
  }

  /**
   * POST /v1/coupons/:id/validate
   * Validate a coupon code for a given cart.
   */
  @Post(':id/validate')
  @RequireTenantAccess({ serviceScopes: ['coupons:read'] })
  @ApiOperation({ summary: 'Validate a coupon' })
  @ApiBody({ type: ValidateCouponDto })
  @ApiOkResponse({ description: 'Validation result', type: CouponValidationResponse })
  async validate(
    @Req() req: any,
    @Param('id') couponId: string,
    @Body() body: ValidateCouponDto,
  ): Promise<CouponValidationResponse> {
    // Validate endpoint: find coupon by code and check if it's valid
    const merchantId = req.tenantPrincipal?.tenantId;
    const coupon = await this.couponRepo.findByCode(merchantId, body.code);

    if (!coupon) {
      return CouponEntityMapper.toValidationResponse(
        false,
        'Coupon code not found',
      );
    }

    const snap = coupon.snapshot();
    const now = new Date().toISOString();

    // Check validity
    if (snap.status === 'archived') {
      return CouponEntityMapper.toValidationResponse(false, 'Coupon is archived');
    }

    if (snap.starts_at > now) {
      return CouponEntityMapper.toValidationResponse(false, 'Coupon not yet active');
    }

    if (snap.ends_at && snap.ends_at < now) {
      return CouponEntityMapper.toValidationResponse(false, 'Coupon has expired');
    }

    if (snap.max_usages !== null && snap.usages_count >= snap.max_usages) {
      return CouponEntityMapper.toValidationResponse(false, 'Coupon usage limit reached');
    }

    if (snap.min_cart_total !== null && body.cart_value < snap.min_cart_total) {
      return CouponEntityMapper.toValidationResponse(
        false,
        `Minimum cart value not met: ${snap.min_cart_total} cents required`,
      );
    }

    // Valid
    return CouponEntityMapper.toValidationResponse(
      true,
      undefined,
      {
        value: snap.discount_value,
        type: snap.discount_type,
      },
    );
  }
}
