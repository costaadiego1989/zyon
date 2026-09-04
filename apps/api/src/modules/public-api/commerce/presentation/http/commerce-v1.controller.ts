import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { currentTenantPrincipal } from '../../../../../shared/auth/tenant-principal.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import {
  ConnectCommerceUseCase,
  DisconnectCommerceUseCase,
  GetCommerceConnectionUseCase,
  SyncCommerceConnectionUseCase,
} from '../../../../commerce/application/manage-commerce-connection.use-cases.js';
import type { SaveMerchantCommerceCredentialsInput } from '../../../../commerce/domain/ports/commerce-connection.port.js';
import { CommerceEntityMapper } from '../../application/mappers/commerce-entity.mapper.js';
import {
  ConnectCommerceDto,
  CommerceProvider,
  UpdateCommerceDto,
  CommerceConnectionResponse,
} from './dtos/commerce.dtos.js';

@ApiTags('Commerce Connections')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('commerce/connections')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class CommerceV1Controller {
  constructor(
    private readonly getConnection: GetCommerceConnectionUseCase,
    private readonly connectCommerce: ConnectCommerceUseCase,
    private readonly disconnectCommerce: DisconnectCommerceUseCase,
    private readonly syncConnection: SyncCommerceConnectionUseCase,
  ) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ['commerce:read'] })
  @ApiOperation({ summary: 'List commerce connections' })
  @ApiResponse({ status: 200, description: 'Commerce connections list', type: [CommerceConnectionResponse] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async list(@Req() request: any) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const connection = await this.getConnection.execute(merchantId);
    const connections = connection
      ? [CommerceEntityMapper.toResponse(connection)]
      : [];
    return { connections, total: connections.length };
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['commerce:write'] })
  @ApiOperation({ summary: 'Connect a new commerce store' })
  @ApiBody({ type: ConnectCommerceDto })
  @ApiResponse({ status: 201, description: 'Commerce connection created', type: CommerceConnectionResponse })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async connect(
    @Req() request: any,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: ConnectCommerceDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const input = this.mapConnectInput(merchantId, body);
    const connection = await this.connectCommerce.execute(input);
    return CommerceEntityMapper.toResponse(connection);
  }

  @Get(':id')
  @RequireTenantAccess({ serviceScopes: ['commerce:read'] })
  @ApiOperation({ summary: 'Get commerce connection details' })
  @ApiParam({ name: 'id', type: 'string', description: 'Connection ID' })
  @ApiResponse({ status: 200, description: 'Commerce connection details', type: CommerceConnectionResponse })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async getById(
    @Req() request: any,
    @Param('id') id: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const connection = await this.getConnection.execute(merchantId);
    if (!connection || connection.merchantId !== id) {
      throw new NotFoundException('commerce_connection_not_found');
    }
    return CommerceEntityMapper.toResponse(connection);
  }

  @Patch(':id')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['commerce:write'] })
  @ApiOperation({ summary: 'Update commerce connection' })
  @ApiParam({ name: 'id', type: 'string', description: 'Connection ID' })
  @ApiBody({ type: UpdateCommerceDto })
  @ApiResponse({ status: 200, description: 'Commerce connection updated', type: CommerceConnectionResponse })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async update(
    @Req() request: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: UpdateCommerceDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const existing = await this.getConnection.execute(merchantId);
    if (!existing || existing.merchantId !== id) {
      throw new NotFoundException('commerce_connection_not_found');
    }
    const input = this.mapUpdateInput(merchantId, existing.provider, body);
    const connection = await this.connectCommerce.execute(input);
    return CommerceEntityMapper.toResponse(connection);
  }

  @Delete(':id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenantAccess({ serviceScopes: ['commerce:write'] })
  @ApiOperation({ summary: 'Disconnect commerce store' })
  @ApiParam({ name: 'id', type: 'string', description: 'Connection ID' })
  @ApiResponse({ status: 204, description: 'Commerce connection removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async disconnect(
    @Req() request: any,
    @Param('id') id: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const existing = await this.getConnection.execute(merchantId);
    if (!existing || existing.merchantId !== id) {
      throw new NotFoundException('commerce_connection_not_found');
    }
    await this.disconnectCommerce.execute(merchantId);
  }

  @Post(':id/sync')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['commerce:write'] })
  @ApiOperation({ summary: 'Trigger manual sync for commerce connection' })
  @ApiParam({ name: 'id', type: 'string', description: 'Connection ID' })
  @ApiResponse({ status: 200, description: 'Sync triggered successfully', type: CommerceConnectionResponse })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async sync(
    @Req() request: any,
    @Param('id') id: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const existing = await this.getConnection.execute(merchantId);
    if (!existing || existing.merchantId !== id) {
      throw new NotFoundException('commerce_connection_not_found');
    }
    const connection = await this.syncConnection.execute(merchantId);
    return CommerceEntityMapper.toResponse(connection);
  }

  private mapConnectInput(
    merchantId: string,
    dto: ConnectCommerceDto,
  ): SaveMerchantCommerceCredentialsInput {
    switch (dto.platform) {
      case CommerceProvider.WooCommerce: {
        const creds = dto.credentials as any;
        return {
          merchantId,
          provider: 'woocommerce',
          storeUrl: creds.store_url,
          consumerKey: creds.consumer_key,
          consumerSecret: creds.consumer_secret,
          webhookSecret: creds.webhook_secret,
        };
      }
      case CommerceProvider.Magento: {
        const creds = dto.credentials as any;
        return {
          merchantId,
          provider: 'magento',
          baseUrl: creds.base_url,
          accessToken: creds.access_token,
          storeCode: creds.store_code,
        };
      }
      case CommerceProvider.VTEX: {
        const creds = dto.credentials as any;
        return {
          merchantId,
          provider: 'vtex',
          accountName: creds.account_name,
          appKey: creds.app_key,
          appToken: creds.app_token,
        };
      }
    }
  }

  private mapUpdateInput(
    merchantId: string,
    currentProvider: string,
    dto: UpdateCommerceDto,
  ): SaveMerchantCommerceCredentialsInput {
    const creds = dto.credentials ?? {};
    switch (currentProvider) {
      case 'woocommerce':
        return {
          merchantId,
          provider: 'woocommerce',
          storeUrl: creds.store_url ?? '',
          consumerKey: creds.consumer_key ?? '',
          consumerSecret: creds.consumer_secret ?? '',
          webhookSecret: creds.webhook_secret,
        };
      case 'magento':
        return {
          merchantId,
          provider: 'magento',
          baseUrl: creds.base_url ?? '',
          accessToken: creds.access_token ?? '',
          storeCode: creds.store_code ?? '',
        };
      case 'vtex':
        return {
          merchantId,
          provider: 'vtex',
          accountName: creds.account_name ?? '',
          appKey: creds.app_key ?? '',
          appToken: creds.app_token ?? '',
        };
      default:
        return {
          merchantId,
          provider: currentProvider as any,
          storeUrl: creds.store_url ?? '',
          consumerKey: creds.consumer_key ?? '',
          consumerSecret: creds.consumer_secret ?? '',
        };
    }
  }
}
