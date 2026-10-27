import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { GetDashboardMetricsUseCase, DashboardPeriod } from '../../../../store-analytics/application/use-cases/get-dashboard-metrics.use-case.js';
import { GetProductPerformanceUseCase } from '../../../../store-analytics/application/use-cases/get-product-performance.use-case.js';
import { GetProductAnalyticsUseCase } from '../../../../store-analytics/application/use-cases/get-product-analytics.use-case.js';
import { GetOfferRoiUseCase } from '../../../../store-analytics/application/use-cases/get-offer-roi.use-case.js';
import { GetPaymentMetricsUseCase } from '../../../../store-analytics/application/use-cases/get-payment-metrics.use-case.js';
import { GetCustomerMetricsUseCase } from '../../../../store-analytics/application/use-cases/get-customer-metrics.use-case.js';
import { AnalyticsEntityMapper } from '../../application/mappers/analytics-entity.mapper.js';
import {
  DashboardMetricsResponse,
  ProductPerformanceResponse,
  ProductPerformanceDto,
  OfferRoiDto,
  PaymentMetricsResponse,
  CustomerMetricsResponse,
} from './dtos/analytics.dtos.js';

@ApiTags('Analytics')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('analytics')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class AnalyticsV1Controller {
  constructor(
    private readonly getDashboardMetrics: GetDashboardMetricsUseCase,
    private readonly getProductPerformance: GetProductPerformanceUseCase,
    private readonly getProductAnalytics: GetProductAnalyticsUseCase,
    private readonly getOfferRoi: GetOfferRoiUseCase,
    private readonly getPaymentMetrics: GetPaymentMetricsUseCase,
    private readonly getCustomerMetrics: GetCustomerMetricsUseCase,
  ) {}

  @Get('dashboard')
  @RequireTenantAccess({ serviceScopes: ['analytics:read'] })
  @ApiOperation({ summary: 'Get dashboard metrics' })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month'], example: 'week' })
  @ApiOkResponse({ description: 'Dashboard metrics with daily breakdown and trend', type: DashboardMetricsResponse })
  async dashboard(
    @Req() req: any,
    @Query('period') period?: DashboardPeriod,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.getDashboardMetrics.execute(merchantId, period ?? 'week');
    return AnalyticsEntityMapper.toDashboardMetricsResponse(result);
  }

  @Get('products')
  @RequireTenantAccess({ serviceScopes: ['analytics:read'] })
  @ApiOperation({ summary: 'Get product performance list' })
  @ApiQuery({ name: 'date_from', required: false, example: '2024-08-01' })
  @ApiQuery({ name: 'date_to', required: false, example: '2024-08-31' })
  @ApiQuery({ name: 'month', required: false, example: '2024-08', description: 'Fallback when date_from/date_to not provided' })
  @ApiOkResponse({ description: 'Product performance metrics', type: ProductPerformanceResponse })
  async products(
    @Req() req: any,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('month') month?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    if (dateFrom && dateTo) {
      const result = await this.getProductAnalytics.execute(
        merchantId,
        new Date(dateFrom),
        new Date(dateTo),
      );
      return AnalyticsEntityMapper.toProductPerformanceResponse(result);
    }

    const result = await this.getProductPerformance.execute(merchantId, month);
    return AnalyticsEntityMapper.toProductPerformanceResponse({
      ...result,
      period: { from: new Date(), to: new Date() },
    });
  }

  @Get('products/:productId')
  @RequireTenantAccess({ serviceScopes: ['analytics:read'] })
  @ApiOperation({ summary: 'Get analytics for a specific product' })
  @ApiQuery({ name: 'date_from', required: false, example: '2024-08-01' })
  @ApiQuery({ name: 'date_to', required: false, example: '2024-08-31' })
  @ApiOkResponse({ description: 'Single product analytics', type: ProductPerformanceDto })
  async productDetail(
    @Req() req: any,
    @Param('productId') productId: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const { fromDate, toDate } = this.resolvePeriod(dateFrom, dateTo);
    const result = await this.getProductAnalytics.execute(merchantId, fromDate, toDate);
    const product = result.products.find((p: any) => p.productId === productId);

    if (!product) {
      return {
        product_id: productId,
        product_name: 'Unknown',
        impressions: 0,
        add_to_cart_count: 0,
        purchase_count: 0,
        conversion_rate: 0,
        revenue_cents: 0,
        period_from: fromDate.toISOString().split('T')[0],
        period_to: toDate.toISOString().split('T')[0],
      };
    }

    return {
      product_id: product.productId,
      product_name: product.productName,
      impressions: product.impressions,
      add_to_cart_count: product.addToCartCount,
      purchase_count: product.purchaseCount,
      conversion_rate: product.conversionRate,
      revenue_cents: product.revenue,
      period_from: fromDate.toISOString().split('T')[0],
      period_to: toDate.toISOString().split('T')[0],
    };
  }

  @Get('offers/roi')
  @RequireTenantAccess({ serviceScopes: ['analytics:read'] })
  @ApiOperation({ summary: 'Get offer ROI metrics' })
  @ApiQuery({ name: 'date_from', required: false, example: '2024-08-01' })
  @ApiQuery({ name: 'date_to', required: false, example: '2024-08-31' })
  @ApiOkResponse({ description: 'Offer ROI metrics', type: OfferRoiDto })
  async offersRoi(
    @Req() req: any,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const { fromDate, toDate } = this.resolvePeriod(dateFrom, dateTo);
    const result = await this.getOfferRoi.execute(merchantId, fromDate, toDate);
    return AnalyticsEntityMapper.toOfferRoiResponse(result);
  }

  @Get('payments')
  @RequireTenantAccess({ serviceScopes: ['analytics:read'] })
  @ApiOperation({ summary: 'Get payment metrics' })
  @ApiQuery({ name: 'date_from', required: false, example: '2024-08-01' })
  @ApiQuery({ name: 'date_to', required: false, example: '2024-08-31' })
  @ApiOkResponse({ description: 'Payment success/failure metrics by provider', type: PaymentMetricsResponse })
  async payments(
    @Req() req: any,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const { fromDate, toDate } = this.resolvePeriod(dateFrom, dateTo);
    const result = await this.getPaymentMetrics.execute(merchantId, fromDate, toDate);
    return AnalyticsEntityMapper.toPaymentMetricsResponse(result);
  }

  @Get('customers')
  @RequireTenantAccess({ serviceScopes: ['analytics:read'] })
  @ApiOperation({ summary: 'Get customer metrics' })
  @ApiQuery({ name: 'date_from', required: false, example: '2024-08-01' })
  @ApiQuery({ name: 'date_to', required: false, example: '2024-08-31' })
  @ApiOkResponse({ description: 'Customer count and retention metrics', type: CustomerMetricsResponse })
  async customers(
    @Req() req: any,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const { fromDate, toDate } = this.resolvePeriod(dateFrom, dateTo);
    const result = await this.getCustomerMetrics.execute(merchantId, fromDate, toDate);
    return AnalyticsEntityMapper.toCustomerMetricsResponse(result);
  }

  private resolvePeriod(from?: string, to?: string): { fromDate: Date; toDate: Date } {
    const now = new Date();
    const toDate = to ? new Date(to) : now;
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    return { fromDate, toDate };
  }
}
