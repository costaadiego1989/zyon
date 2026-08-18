# Phase 1 Implementation Plan: REST v1 API Evolution

**Status**: Ready for Implementation  
**Date**: 2026-08-18  
**Scope**: Build 3 public API modules (checkouts, orders, products) with zero breaking changes to existing endpoints

---

## Executive Summary

Phase 1 introduces a new `public-api` module layer under `/v1/checkouts`, `/v1/orders`, `/v1/products` that:
- **Delegates to existing use-cases** (no business logic duplication)
- **Uses existing infrastructure** (no new middleware, guards, or filters)
- **Adds response envelope** via shared interceptor (`{ data, meta, pagination? }`)
- **Provides snake_case contracts** with explicit DTOs
- **Maintains 100% backward compatibility** (existing endpoints remain unchanged)

**Estimated effort**: 3-4 weeks for Phase 1  
**Breaking changes**: ZERO to existing consumers (widget, storefront, dashboard keep working)

---

## Architecture Overview

### What Already Exists (Reuse, Don't Build)

| Component | Location | Reuse Pattern |
|-----------|----------|---------------|
| Auth guards | `shared/tenant/tenant-credential.guard.ts` + `tenant-access.guard.ts` | `@UseGuards(...)` on controllers |
| Response errors | `shared/http/problem-details.filter.ts` | Already applied globally |
| Idempotency | `shared/http/idempotency.interceptor.ts` | `@Idempotent()` decorator |
| Rate limiting | `shared/rate-limit/rate-limit.guard.ts` | `@RateLimit()` or `@SkipRateLimit()` |
| Request timeout | `shared/http/request-timeout.interceptor.ts` | `@RequestTimeout(ms)` |
| ETag/concurrency | `shared/http/entity-tag.service.ts` | `@UseGuards(...)` + manual validation |
| API versioning | `shared/http/api-versioning.ts` | Already strips `/v1`, adds header |
| OpenAPI/Swagger | `shared/http/api-documentation.ts` | Add regex patterns to `PUBLIC_OPERATIONS` |
| Correlation IDs | `shared/http/correlation-id.middleware.ts` | Already applied globally |
| Tenant isolation | `shared/tenant/tenant.interceptor.ts` | Already applied globally |

### What We Build (New)

| Component | Purpose |
|-----------|---------|
| `ResponseEnvelopeInterceptor` | Auto-wrap all v1 responses with `{ data, meta, pagination? }` |
| `CursorPaginationHelper` | Reusable pagination utility for list endpoints |
| `PublicApiCheckoutsModule` | `/v1/checkouts` endpoints + DTOs + mappers |
| `PublicApiOrdersModule` | `/v1/orders` endpoints + DTOs + mappers |
| `PublicApiProductsModule` | `/v1/products` endpoints + DTOs + mappers |
| Request/Response DTOs | Explicit contracts (snake_case on wire, camelCase internal) |
| Entity Mappers | Domain → DTO transformations (pure functions) |

---

## Folder Structure

```
apps/api/src/
├── modules/
│   ├── public-api/                           # NEW: Public v1 API layer
│   │   ├── checkouts/
│   │   │   ├── presentation/http/
│   │   │   │   ├── checkouts-v1.controller.ts
│   │   │   │   ├── __tests__/
│   │   │   │   │   ├── checkouts-v1.controller.spec.ts
│   │   │   │   │   └── checkouts-v1.e2e.spec.ts
│   │   │   │   └── dtos/
│   │   │   │       ├── start-checkout.request.dto.ts
│   │   │   │       ├── checkout-session.response.dto.ts
│   │   │   │       ├── track-event.request.dto.ts
│   │   │   │       ├── get-session.response.dto.ts
│   │   │   │       ├── send-message.request.dto.ts
│   │   │   │       ├── chat-message.response.dto.ts
│   │   │   │       ├── evaluate-shipping.request.dto.ts
│   │   │   │       ├── shipping-quotes.response.dto.ts
│   │   │   │       ├── apply-offer.request.dto.ts
│   │   │   │       ├── complete-order.request.dto.ts
│   │   │   │       ├── order-completed.response.dto.ts
│   │   │   │       ├── update-cart.request.dto.ts
│   │   │   │       └── cart.response.dto.ts
│   │   │   ├── application/
│   │   │   │   └── mappers/
│   │   │   │       └── checkout-entity.mapper.ts
│   │   │   └── public-api-checkouts.module.ts
│   │   ├── orders/
│   │   │   ├── presentation/http/
│   │   │   │   ├── orders-v1.controller.ts
│   │   │   │   ├── __tests__/
│   │   │   │   │   ├── orders-v1.controller.spec.ts
│   │   │   │   │   └── orders-v1.e2e.spec.ts
│   │   │   │   └── dtos/
│   │   │   │       ├── order-summary.response.dto.ts
│   │   │   │       ├── order-detail.response.dto.ts
│   │   │   │       ├── cancel-order.request.dto.ts
│   │   │   │       ├── update-tracking.request.dto.ts
│   │   │   │       └── tracking.response.dto.ts
│   │   │   ├── application/
│   │   │   │   └── mappers/
│   │   │   │       └── order-entity.mapper.ts
│   │   │   └── public-api-orders.module.ts
│   │   ├── products/
│   │   │   ├── presentation/http/
│   │   │   │   ├── products-v1.controller.ts
│   │   │   │   ├── __tests__/
│   │   │   │   │   ├── products-v1.controller.spec.ts
│   │   │   │   │   └── products-v1.e2e.spec.ts
│   │   │   │   └── dtos/
│   │   │   │       ├── product-summary.response.dto.ts
│   │   │   │       ├── product-detail.response.dto.ts
│   │   │   │       ├── create-product.request.dto.ts
│   │   │   │       ├── update-product.request.dto.ts
│   │   │   │       ├── variant.response.dto.ts
│   │   │   │       └── product-list.response.dto.ts
│   │   │   ├── application/
│   │   │   │   └── mappers/
│   │   │   │       └── product-entity.mapper.ts
│   │   │   └── public-api-products.module.ts
│   │   └── public-api.module.ts               # Barrel module
├── shared/
│   └── http/
│       ├── response-envelope.interceptor.ts   # NEW
│       ├── pagination/
│       │   ├── cursor-pagination.helper.ts    # NEW
│       │   └── cursor-pagination.types.ts
│       └── ... (existing files unchanged)
```

---

## Implementation Details

### 1. Response Envelope Interceptor

**File**: `apps/api/src/shared/http/response-envelope.interceptor.ts`

```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponseEnvelope<T> {
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
    version: 'v1';
  };
  pagination?: {
    next_cursor?: string | null;
    has_more: boolean;
  };
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const requestId = request.correlationId || `req_${Date.now()}`;

    return next.handle().pipe(
      map((response) => {
        // If response already has envelope structure, return as-is
        if (response?.data !== undefined && response?.meta !== undefined) {
          return response;
        }

        // If response has pagination, extract it
        const { pagination, ...data } = response || {};

        const envelope: ApiResponseEnvelope<any> = {
          data: data || response,
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: 'v1',
          },
        };

        if (pagination) {
          envelope.pagination = pagination;
        }

        return envelope;
      }),
    );
  }
}
```

### 2. Cursor Pagination Helper

**File**: `apps/api/src/shared/http/pagination/cursor-pagination.helper.ts`

```typescript
export interface CursorPageResult<T> {
  data: T[];
  next_cursor?: string | null;
  has_more: boolean;
}

export class CursorPaginationHelper {
  /**
   * Format use-case response into paginated API response
   * Use-case returns { data, nextCursor } — we transform to API shape
   */
  static format<T, R>(
    useCaseResult: { data: T[]; nextCursor: string | null },
    mapperFn: (item: T) => R,
  ): CursorPageResult<R> {
    return {
      data: useCaseResult.data.map(mapperFn),
      next_cursor: useCaseResult.nextCursor,
      has_more: useCaseResult.nextCursor !== null,
    };
  }

  /**
   * Validate and parse cursor from query param
   */
  static validateCursor(cursor?: string): { valid: boolean; error?: string } {
    if (!cursor) return { valid: true };
    
    try {
      // Cursor is base64(JSON({ createdAt, id }))
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      JSON.parse(decoded);
      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid cursor format' };
    }
  }

  /**
   * Extract cursor components for query
   */
  static decodeCursor(cursor: string): { createdAt: string; id: string } {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }
}
```

### 3. Checkouts v1 Controller

**File**: `apps/api/src/modules/public-api/checkouts/presentation/http/checkouts-v1.controller.ts`

```typescript
import { Controller, Post, Get, Patch, Req, Param, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { TenantCredentialGuard } from '@shared/tenant/tenant-credential.guard';
import { TenantAccessGuard, RequireTenantAccess } from '@shared/tenant/tenant-access.guard';
import { ResponseEnvelopeInterceptor } from '@shared/http/response-envelope.interceptor';
import { Idempotent } from '@shared/http/idempotency/idempotency.decorator';
import { currentTenantPrincipal } from '@shared/tenant/current-tenant.decorator';

import { StartCheckoutUseCase } from '@modules/checkout/application/use-cases/start-checkout.use-case';
import { TrackCheckoutEventUseCase } from '@modules/checkout/application/use-cases/track-checkout-event.use-case';
import { GetCheckoutSessionUseCase } from '@modules/checkout/application/use-cases/get-checkout-session.use-case';
import { SendChatMessageUseCase } from '@modules/checkout/application/use-cases/send-chat-message.use-case';
import { EvaluateShippingUseCase } from '@modules/checkout/application/use-cases/evaluate-shipping.use-case';
import { ApplyOfferUseCase } from '@modules/checkout/application/use-cases/apply-offer.use-case';
import { CompleteOrderUseCase } from '@modules/checkout/application/use-cases/complete-order.use-case';
import { UpdateCartUseCase } from '@modules/checkout/application/use-cases/update-cart.use-case';

import { CheckoutEntityMapper } from '../mappers/checkout-entity.mapper';
import { StartCheckoutRequestDto } from './dtos/start-checkout.request.dto';
import { CheckoutSessionResponseDto } from './dtos/checkout-session.response.dto';
import { TrackEventRequestDto } from './dtos/track-event.request.dto';
import { SendMessageRequestDto } from './dtos/send-message.request.dto';
import { EvaluateShippingRequestDto } from './dtos/evaluate-shipping.request.dto';
import { ApplyOfferRequestDto } from './dtos/apply-offer.request.dto';
import { CompleteOrderRequestDto } from './dtos/complete-order.request.dto';
import { UpdateCartRequestDto } from './dtos/update-cart.request.dto';

@ApiTags('Checkouts')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('checkouts')
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@UseInterceptors(ResponseEnvelopeInterceptor)
export class CheckoutsV1Controller {
  constructor(
    private readonly startCheckout: StartCheckoutUseCase,
    private readonly trackEvent: TrackCheckoutEventUseCase,
    private readonly getCheckout: GetCheckoutSessionUseCase,
    private readonly sendMessage: SendChatMessageUseCase,
    private readonly evaluateShipping: EvaluateShippingUseCase,
    private readonly applyOffer: ApplyOfferUseCase,
    private readonly completeOrder: CompleteOrderUseCase,
    private readonly updateCart: UpdateCartUseCase,
  ) {}

  @Post()
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Start a new checkout session' })
  @ApiCreatedResponse({ type: CheckoutSessionResponseDto })
  async start(@Req() req: any, @Body() body: StartCheckoutRequestDto) {
    const merchantId = currentTenantPrincipal(req).tenantId;
    const result = await this.startCheckout.execute({
      merchantId,
      sessionId: body.session_id,
      cart: body.cart,
      customer: body.customer,
      shipping: body.shipping,
    });
    return CheckoutEntityMapper.toCheckoutSessionResponse(result);
  }

  @Get(':checkoutId')
  @RequireTenantAccess({ serviceScopes: ['checkout:read'] })
  @ApiOperation({ summary: 'Get checkout session details' })
  @ApiOkResponse({ type: CheckoutSessionResponseDto })
  async get(@Req() req: any, @Param('checkoutId') checkoutId: string) {
    const merchantId = currentTenantPrincipal(req).tenantId;
    const session = await this.getCheckout.execute(merchantId, checkoutId);
    return CheckoutEntityMapper.toCheckoutSessionResponse(session);
  }

  @Post(':checkoutId/events')
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Track a checkout event' })
  async trackEvent(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: TrackEventRequestDto,
  ) {
    const merchantId = currentTenantPrincipal(req).tenantId;
    await this.trackEvent.execute(merchantId, checkoutId, body.event_type, body.data);
    return { success: true };
  }

  @Post(':checkoutId/messages')
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Send chat message' })
  async sendMessage(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: SendMessageRequestDto,
  ) {
    const merchantId = currentTenantPrincipal(req).tenantId;
    const result = await this.sendMessage.execute(merchantId, checkoutId, body.message);
    return CheckoutEntityMapper.toChatMessageResponse(result);
  }

  @Post(':checkoutId/shipping/evaluate')
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Evaluate shipping options' })
  async evaluateShipping(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: EvaluateShippingRequestDto,
  ) {
    const merchantId = currentTenantPrincipal(req).tenantId;
    const result = await this.evaluateShipping.execute(merchantId, checkoutId, body);
    return CheckoutEntityMapper.toShippingQuotesResponse(result);
  }

  @Post(':checkoutId/offers')
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Apply offer to checkout' })
  async applyOffer(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: ApplyOfferRequestDto,
  ) {
    const merchantId = currentTenantPrincipal(req).tenantId;
    const result = await this.applyOffer.execute(merchantId, checkoutId, body.offer_id);
    return CheckoutEntityMapper.toOfferResponse(result);
  }

  @Post(':checkoutId/complete')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Complete checkout and create order' })
  async complete(@Req() req: any, @Param('checkoutId') checkoutId: string, @Body() body: CompleteOrderRequestDto) {
    const merchantId = currentTenantPrincipal(req).tenantId;
    const result = await this.completeOrder.execute(merchantId, checkoutId, body);
    return CheckoutEntityMapper.toOrderCompletedResponse(result);
  }

  @Patch(':checkoutId/cart')
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Update checkout cart' })
  async updateCart(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: UpdateCartRequestDto,
  ) {
    const merchantId = currentTenantPrincipal(req).tenantId;
    const result = await this.updateCart.execute(merchantId, checkoutId, body.items);
    return CheckoutEntityMapper.toCartResponse(result);
  }
}
```

### 4. DTO Pattern

**File**: `apps/api/src/modules/public-api/checkouts/presentation/http/dtos/start-checkout.request.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested, IsString, IsOptional, IsArray } from 'class-validator';

export class CartItemDto {
  @ApiProperty({ example: 'sku_123' })
  sku: string;

  @ApiProperty({ example: 'Product Name' })
  name: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ example: 9999 })
  price_minor: number;
}

export class CustomerInputDto {
  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  full_name?: string;

  @ApiPropertyOptional({ example: '+55 11 98765-4321' })
  phone?: string;
}

export class StartCheckoutRequestDto {
  @ApiPropertyOptional({ example: 'sess_abc123' })
  @IsOptional()
  @IsString()
  session_id?: string;

  @ApiProperty({ type: [CartItemDto] })
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  cart: CartItemDto[];

  @ApiPropertyOptional({ type: CustomerInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerInputDto)
  customer?: CustomerInputDto;
}
```

**File**: `apps/api/src/modules/public-api/checkouts/presentation/http/dtos/checkout-session.response.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

export class CheckoutSessionResponseDto {
  @ApiProperty({ example: 'chk_abc123' })
  @Expose({ name: 'id' })
  id: string;

  @ApiProperty({ example: 'sess_xyz789' })
  @Expose({ name: 'session_id' })
  sessionId: string;

  @ApiProperty({ example: 'conv_999' })
  @Expose({ name: 'conversation_id' })
  conversationId: string;

  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiProperty({ example: 9999 })
  @Expose({ name: 'total_minor' })
  totalMinor: number;

  @ApiPropertyOptional({ example: true })
  @Expose({ name: 'agent_enabled' })
  agentEnabled?: boolean;

  @ApiProperty()
  @Expose({ name: 'created_at' })
  createdAt: string;

  // NO internal fields (timestamps, internal flags, etc.)
  @Exclude()
  internal_flags?: any;

  @Exclude()
  debug_data?: any;
}
```

### 5. Mapper Pattern

**File**: `apps/api/src/modules/public-api/checkouts/application/mappers/checkout-entity.mapper.ts`

```typescript
import { CheckoutSession } from '@modules/checkout/domain/entities/checkout-session.entity';
import { CheckoutSessionResponseDto } from '../presentation/http/dtos/checkout-session.response.dto';
import { ChatMessageResponseDto } from '../presentation/http/dtos/chat-message.response.dto';
import { ShippingQuotesResponseDto } from '../presentation/http/dtos/shipping-quotes.response.dto';
import { CartResponseDto } from '../presentation/http/dtos/cart.response.dto';

export class CheckoutEntityMapper {
  /**
   * Map checkout domain entity to API response DTO
   * Pure function: no side effects
   */
  static toCheckoutSessionResponse(entity: CheckoutSession): CheckoutSessionResponseDto {
    return {
      id: entity.id,
      sessionId: entity.sessionId,
      conversationId: entity.conversationId,
      status: entity.status,
      totalMinor: entity.cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
      agentEnabled: entity.agentEnabled ?? true,
      createdAt: entity.createdAt.toISOString(),
      // NO internal fields
    };
  }

  static toChatMessageResponse(result: any): ChatMessageResponseDto {
    return {
      id: result.messageId,
      role: result.role, // 'assistant' or 'user'
      content: result.text,
      created_at: result.createdAt.toISOString(),
    };
  }

  static toShippingQuotesResponse(result: any): ShippingQuotesResponseDto {
    return {
      quotes: result.quotes.map((q: any) => ({
        id: q.id,
        carrier: q.carrier,
        delivery_days: q.daysToDeliver,
        price_minor: q.priceMinor,
      })),
    };
  }

  static toCartResponse(entity: CheckoutSession): CartResponseDto {
    return {
      items: entity.cart.map((item) => ({
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        price_minor: item.price,
      })),
      total_minor: entity.cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    };
  }

  static toOfferResponse(result: any): any {
    return {
      offer_id: result.offerId,
      type: result.type,
      discount_minor: result.discountMinor,
      accepted: result.accepted,
    };
  }

  static toOrderCompletedResponse(result: any): any {
    return {
      order_id: result.orderId,
      status: 'completed',
      created_at: result.createdAt.toISOString(),
    };
  }
}
```

### 6. Module Registration

**File**: `apps/api/src/modules/public-api/checkouts/public-api-checkouts.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { CheckoutModule } from '@modules/checkout/checkout.module';
import { CheckoutsV1Controller } from './presentation/http/checkouts-v1.controller.ts';

@Module({
  controllers: [CheckoutsV1Controller],
  imports: [CheckoutModule], // Reuse existing use-cases
})
export class PublicApiCheckoutsModule {}
```

**File**: `apps/api/src/modules/public-api/public-api.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { PublicApiCheckoutsModule } from './checkouts/public-api-checkouts.module';
import { PublicApiOrdersModule } from './orders/public-api-orders.module';
import { PublicApiProductsModule } from './products/public-api-products.module';

@Module({
  imports: [
    PublicApiCheckoutsModule,
    PublicApiOrdersModule,
    PublicApiProductsModule,
  ],
})
export class PublicApiModule {}
```

**Update**: `apps/api/src/app.module.ts`

```typescript
// In @Module({ imports: [...] })
import { PublicApiModule } from './modules/public-api/public-api.module';

@Module({
  imports: [
    // ... existing modules ...
    PublicApiModule,  // Add after existing modules
  ],
})
export class AppModule {}
```

### 7. OpenAPI Registration

**Update**: `apps/api/src/shared/http/api-documentation.ts`

Add to `PUBLIC_OPERATIONS` array:

```typescript
const PUBLIC_OPERATIONS = [
  // ... existing entries ...
  
  // Checkouts v1
  { methods: ['post'], path: /^\/checkouts$/, security: 'tenant' },
  { methods: ['get'], path: /^\/checkouts\/[^/]+$/, security: 'tenant' },
  { methods: ['post'], path: /^\/checkouts\/[^/]+\/events$/, security: 'tenant' },
  { methods: ['post'], path: /^\/checkouts\/[^/]+\/messages$/, security: 'tenant' },
  { methods: ['post'], path: /^\/checkouts\/[^/]+\/shipping\/evaluate$/, security: 'tenant' },
  { methods: ['post'], path: /^\/checkouts\/[^/]+\/offers$/, security: 'tenant' },
  { methods: ['post'], path: /^\/checkouts\/[^/]+\/complete$/, security: 'tenant' },
  { methods: ['patch'], path: /^\/checkouts\/[^/]+\/cart$/, security: 'tenant' },

  // Orders v1
  { methods: ['get'], path: /^\/orders$/, security: 'tenant' },
  { methods: ['get'], path: /^\/orders\/[^/]+$/, security: 'tenant' },
  { methods: ['post'], path: /^\/orders\/[^/]+\/cancel$/, security: 'tenant' },
  { methods: ['get'], path: /^\/orders\/[^/]+\/tracking$/, security: 'tenant' },
  { methods: ['patch'], path: /^\/orders\/[^/]+\/tracking$/, security: 'tenant' },

  // Products v1
  { methods: ['get'], path: /^\/products$/, security: 'tenant' },
  { methods: ['get'], path: /^\/products\/[^/]+$/, security: 'tenant' },
  { methods: ['post'], path: /^\/products$/, security: 'tenant' },
  { methods: ['patch'], path: /^\/products\/[^/]+$/, security: 'tenant' },
  { methods: ['delete'], path: /^\/products\/[^/]+$/, security: 'tenant' },
];
```

---

## Testing Strategy

### Unit Tests (Per Controller)

- Mock use-cases, verify delegates correctly
- Test DTO validation (invalid input → 422)
- Test mapper transformations

### E2E Tests

- Full request flow with real DB
- Verify response envelope shape
- Verify pagination cursor handling
- Verify error responses (RFC 7807 format)
- Verify idempotency (same Idempotency-Key → same response)

### Validation Checkpoints

Per module:
- [ ] Controller tests pass
- [ ] E2E tests pass
- [ ] DTOs validated in swagger spec
- [ ] Mappers tested (domain → response)
- [ ] OpenAPI routes appear in `/docs`
- [ ] Widget e2e still green (using old routes)
- [ ] Storefront e2e still green (using old routes)

---

## Rollout Sequence

1. **Create shared infrastructure** (interceptor, helper)
2. **Implement Checkouts v1** → prove pattern
3. **Implement Orders v1** → refine pagination
4. **Implement Products v1** → extend patterns
5. **Update OpenAPI** with all v1 routes
6. **Run full e2e test suite** (old + new routes)
7. **Deploy to dev environment** for testing
8. **Collect feedback**, iterate if needed
9. **Deploy to production** (widget/storefront still use old routes)

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking existing widget | Widget uses `/embed/*` + `/checkout-settings`, not new `/v1/*` — completely isolated |
| Breaking dashboard | Dashboard uses `/checkout/dashboard/*` (old route) — not affected |
| Tenant isolation violation | All v1 endpoints use existing `TenantCredentialGuard` + `TenantAccessGuard` — same isolation as embed |
| Auth scope creep | New scopes (`checkout:read/write`, `orders:read/write`, `catalog:read/write`) are granular, backward compatible |
| Response shape mismatch | ResponseEnvelopeInterceptor auto-wraps all v1 responses — consistent shape |
| Pagination regression | CursorPaginationHelper centralizes logic — tested once, reused everywhere |

---

## Deliverables Checklist

- [ ] `ResponseEnvelopeInterceptor` created + tested
- [ ] `CursorPaginationHelper` created + tested
- [ ] `PublicApiCheckoutsModule` created (controller, DTOs, mappers)
- [ ] `PublicApiOrdersModule` created (controller, DTOs, mappers)
- [ ] `PublicApiProductsModule` created (controller, DTOs, mappers)
- [ ] `PublicApiModule` barrel created
- [ ] `app.module.ts` updated to import `PublicApiModule`
- [ ] `api-documentation.ts` updated with `PUBLIC_OPERATIONS` entries
- [ ] All unit tests pass
- [ ] All e2e tests pass (old + new)
- [ ] OpenAPI spec updated at `/docs`
- [ ] Widget e2e tests still green
- [ ] Storefront e2e tests still green

---

## Next Steps

1. Review and approve this plan
2. Begin implementation on checkouts module
3. Follow the pattern for orders and products modules
4. Run full test suite before deploy
5. Monitor production for any issues

