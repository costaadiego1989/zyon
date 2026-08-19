import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { GetBillingSubscriptionUseCase } from '../../../../payment/application/payment-platform.use-cases.js';
import { ListBillingPlansUseCase } from '../../application/list-billing-plans.use-case.js';
import { GetBillingUsageUseCase } from '../../application/get-billing-usage.use-case.js';
import { ListBillingInvoicesUseCase } from '../../application/list-billing-invoices.use-case.js';
import { BillingEntityMapper } from '../../application/mappers/billing-entity.mapper.js';
import {
  ChangePlanDto,
  PlanResponse,
  SubscriptionResponse,
  UsageResponse,
  InvoiceResponse,
} from './dtos/billing.dtos.js';

@ApiTags('Billing')
@ApiCookieAuth('console_session')
@Controller('billing')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class BillingV1Controller {
  constructor(
    private readonly listPlansUseCase: ListBillingPlansUseCase,
    private readonly getSubscriptionUseCase: GetBillingSubscriptionUseCase,
    private readonly getUsageUseCase: GetBillingUsageUseCase,
    private readonly listInvoicesUseCase: ListBillingInvoicesUseCase,
  ) {}

  @Get('plans')
  @RequireTenantAccess({ humanOnly: true })
  @ApiOperation({ summary: 'List available billing plans' })
  @ApiOkResponse({ description: 'Available plans', type: [PlanResponse] })
  async listPlans() {
    return this.listPlansUseCase.execute();
  }

  @Get('subscription')
  @RequireTenantAccess({ humanOnly: true })
  @ApiOperation({ summary: 'Get current subscription for merchant' })
  @ApiOkResponse({ description: 'Current subscription', type: SubscriptionResponse })
  async getSubscription(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.getSubscriptionUseCase.execute(merchantId);
    return BillingEntityMapper.toSubscriptionResponse(result);
  }

  @Post('subscription/change')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ humanOnly: true })
  @ApiOperation({ summary: 'Change subscription plan (upgrade/downgrade)' })
  @ApiBody({ type: ChangePlanDto })
  @ApiOkResponse({ description: 'Plan change initiated' })
  async changePlan(@Req() req: any, @Body() body: ChangePlanDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    return this.listPlansUseCase.changePlan(merchantId, body);
  }

  @Get('usage')
  @RequireTenantAccess({ humanOnly: true })
  @ApiOperation({ summary: 'Get current period usage for merchant' })
  @ApiOkResponse({ description: 'Current usage metrics', type: UsageResponse })
  async getUsage(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    return this.getUsageUseCase.execute(merchantId);
  }

  @Get('invoices')
  @RequireTenantAccess({ humanOnly: true })
  @ApiOperation({ summary: 'Get invoice history' })
  @ApiOkResponse({ description: 'Invoice list', type: [InvoiceResponse] })
  async listInvoices(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const results = await this.listInvoicesUseCase.execute(merchantId);
    return results.map(BillingEntityMapper.toInvoiceResponse);
  }
}
