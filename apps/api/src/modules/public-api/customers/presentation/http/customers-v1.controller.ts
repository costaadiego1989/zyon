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
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { CursorPaginationHelper } from '../../../../../shared/http/pagination/cursor-pagination.helper.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import {
  ListCustomersUseCase,
  GetCustomerUseCase,
  ListCustomerOrdersUseCase,
} from '../../../../operations/application/operations-read.use-cases.js';
import { CustomerEntityMapper } from '../../application/mappers/customer-entity.mapper.js';
import {
  CustomerDetailResponse,
  CustomerOrderResponse,
  CustomerSummaryResponse,
} from './dtos/customer.dtos.js';

@ApiTags('Customers')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('customers')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class CustomersV1Controller {
  constructor(
    private readonly listCustomersUseCase: ListCustomersUseCase,
    private readonly getCustomerUseCase: GetCustomerUseCase,
    private readonly listCustomerOrdersUseCase: ListCustomerOrdersUseCase,
  ) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ['customers:read'] })
  @ApiOperation({ summary: 'List customers' })
  @ApiOkResponse({ description: 'Customers list', type: CustomerSummaryResponse, isArray: true })
  async list(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const pageSize = Math.min(limit ?? 20, 100);

    const result = await this.listCustomersUseCase.execute({
      merchantId,
      limit: pageSize,
      cursor,
    });

    return CursorPaginationHelper.format(result, (customer) =>
      CustomerEntityMapper.toCustomerSummaryResponse(customer),
    );
  }

  @Get(':customerId')
  @RequireTenantAccess({ serviceScopes: ['customers:read'] })
  @ApiOperation({ summary: 'Get customer details' })
  @ApiOkResponse({ description: 'Customer detail', type: CustomerDetailResponse })
  async detail(
    @Req() req: any,
    @Param('customerId') customerId: string,
  ): Promise<CustomerDetailResponse> {
    const merchantId = req.tenantPrincipal?.tenantId;
    const customer = await this.getCustomerUseCase.execute(
      merchantId,
      customerId,
    );
    return CustomerEntityMapper.toCustomerDetailResponse(customer);
  }

  @Get(':customerId/orders')
  @RequireTenantAccess({ serviceScopes: ['customers:read', 'orders:read'] })
  @ApiOperation({ summary: 'Get customer order history' })
  @ApiOkResponse({ description: 'Customer orders list', type: CustomerOrderResponse, isArray: true })
  async listCustomerOrders(
    @Req() req: any,
    @Param('customerId') customerId: string,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const pageSize = Math.min(limit ?? 20, 100);

    const result = await this.listCustomerOrdersUseCase.execute({
      merchantId,
      customerId,
      limit: pageSize,
      cursor,
    });

    return CursorPaginationHelper.format(
      result,
      (order) => CustomerEntityMapper.toCustomerOrderResponse(order),
    );
  }
}
