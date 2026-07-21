import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
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
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import {
  ORDER_TRACKING_UPDATER,
  type OrderTrackingUpdater,
} from "../../domain/ports/order-tracking.port.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import {
  GetCustomerUseCase,
  GetOrderUseCase,
  GetPaymentUseCase,
  ListCustomersUseCase,
  ListOrdersUseCase,
  ListPaymentsUseCase,
} from "../../application/operations-read.use-cases.js";
import {
  CancelOrderUseCase,
  CreateOrderFromPaymentUseCase,
  UpdateOrderStatusUseCase,
} from "../../application/order-command.use-cases.js";
import type {
  CustomerDetail,
  CustomerSummary,
  OrderDetail,
  OrderSummary,
  PaymentSummary,
} from "../../domain/ports/operations-read.repository.port.js";
import { UpdateOrderTrackingDto } from "./order-tracking.dto.js";
import {
  CancelOrderDto,
  CreateOrderDto,
  UpdateOrderStatusDto,
} from "./order-command.dto.js";

@ApiTags("Orders")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller("orders")
export class OrdersController {
  constructor(
    private readonly listOrders: ListOrdersUseCase,
    private readonly getOrder: GetOrderUseCase,
    @Inject(ORDER_TRACKING_UPDATER)
    private readonly updateOrderTracking: OrderTrackingUpdater,
    private readonly cancelOrder: CancelOrderUseCase,
    private readonly createOrder: CreateOrderFromPaymentUseCase,
    private readonly updateOrderStatus: UpdateOrderStatusUseCase,
  ) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  async list(
    @Req() request: unknown,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.listOrders.execute({
      merchantId: tenantId(request),
      limit: parseLimit(limit),
      cursor,
    });
    return pageResponse(page, toOrderResponse);
  }

  @Post()
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["orders:write"] })
  async create(
    @Req() request: unknown,
    @Body() body: CreateOrderDto,
  ) {
    const result = await this.createOrder.execute({
      merchantId: tenantId(request),
      paymentId: body.payment_id,
    });
    return {
      ...toOrderDetailResponse(result.order),
      idempotent: result.idempotent,
    };
  }

  @Get(":orderId")
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  async get(
    @Req() request: unknown,
    @Param("orderId") orderId: string,
  ) {
    return toOrderDetailResponse(
      await this.getOrder.execute(tenantId(request), orderId),
    );
  }

  @Post(":orderId/cancel")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["orders:write"] })
  cancel(
    @Req() request: unknown,
    @Param("orderId") orderId: string,
    @Body() body: CancelOrderDto,
  ) {
    return this.cancelOrder.execute({
      merchantId: tenantId(request),
      orderId,
      reason: body.reason,
      notifyCustomer: body.notify_customer,
      restock: body.restock,
    });
  }

  @Put(":orderId/status")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["orders:write"] })
  updateStatus(
    @Req() request: unknown,
    @Param("orderId") orderId: string,
    @Body() body: UpdateOrderStatusDto,
  ) {
    return this.updateOrderStatus.execute({
      merchantId: tenantId(request),
      orderId,
      status: body.status,
    });
  }

  @Get(":orderId/timeline")
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  async timeline(
    @Req() request: unknown,
    @Param("orderId") orderId: string,
  ) {
    const order = await this.getOrder.execute(tenantId(request), orderId);
    return { data: order.timeline };
  }

  @Get(":orderId/tracking")
  @RequireTenantAccess({ serviceScopes: ["tracking:read"] })
  async tracking(
    @Req() request: unknown,
    @Param("orderId") orderId: string,
  ) {
    const order = await this.getOrder.execute(tenantId(request), orderId);
    return {
      order_id: order.id,
      external_order_id: order.externalOrderId,
      tracking_code: order.trackingCode ?? null,
      timeline: order.timeline.filter((entry) => entry.type === "tracking"),
    };
  }

  @Put(":orderId/tracking")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["tracking:write"] })
  async updateTracking(
    @Req() request: unknown,
    @Param("orderId") orderId: string,
    @Body() body: UpdateOrderTrackingDto,
  ) {
    const merchantId = tenantId(request);
    const order = await this.getOrder.execute(merchantId, orderId);
    const result = await this.updateOrderTracking.execute({
      merchantId,
      externalOrderId: order.externalOrderId,
      body: {
        session_id: order.sessionId,
        tracking_code: body.tracking_code,
        carrier: body.carrier,
        tracking_url: body.tracking_url,
        status: body.status,
        events: body.events,
      },
    });
    return {
      updated: result.updated,
      changed: result.changed,
      order_id: order.id,
      external_order_id: order.externalOrderId,
      tracking_code: result.order.trackingCode ?? null,
      shipment: result.shipment,
      events_recorded: result.events_recorded,
    };
  }
}

@ApiTags("Customers")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({ serviceScopes: ["customers:read"] })
@Controller("customers")
export class CustomersController {
  constructor(
    private readonly listCustomers: ListCustomersUseCase,
    private readonly getCustomer: GetCustomerUseCase,
  ) {}

  @Get()
  async list(
    @Req() request: unknown,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.listCustomers.execute({
      merchantId: tenantId(request),
      limit: parseLimit(limit),
      cursor,
    });
    return pageResponse(page, toCustomerResponse);
  }

  @Get(":customerId")
  async get(
    @Req() request: unknown,
    @Param("customerId") customerId: string,
  ) {
    return toCustomerDetailResponse(
      await this.getCustomer.execute(tenantId(request), customerId),
    );
  }
}

@ApiTags("Payments")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({ serviceScopes: ["payments:read"] })
@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly listPayments: ListPaymentsUseCase,
    private readonly getPayment: GetPaymentUseCase,
  ) {}

  @Get()
  async list(
    @Req() request: unknown,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.listPayments.execute({
      merchantId: tenantId(request),
      limit: parseLimit(limit),
      cursor,
    });
    return pageResponse(page, toPaymentResponse);
  }

  @Get(":paymentId")
  async get(
    @Req() request: unknown,
    @Param("paymentId") paymentId: string,
  ) {
    return toPaymentResponse(
      await this.getPayment.execute(tenantId(request), paymentId),
    );
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}

function parseLimit(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function pageResponse<T, R>(
  page: { data: T[]; nextCursor: string | null },
  map: (value: T) => R,
) {
  return {
    data: page.data.map(map),
    next_cursor: page.nextCursor,
    has_more: page.nextCursor !== null,
  };
}

function toOrderResponse(order: OrderSummary) {
  return {
    id: order.id,
    session_id: order.sessionId,
    external_order_id: order.externalOrderId,
    status: order.status,
    total: order.totalMinor,
    currency: order.currency,
    accepted_offer_id: order.acceptedOfferId ?? null,
    tracking_code: order.trackingCode ?? null,
    customer: order.customer,
    cart: order.cart,
    completed_at: order.completedAt,
    cancelled_at: order.cancelledAt ?? null,
    cancellation_reason: order.cancellationReason ?? null,
  };
}

function toOrderDetailResponse(order: OrderDetail) {
  return {
    ...toOrderResponse(order),
    timeline: order.timeline,
  };
}

function toCustomerResponse(customer: CustomerSummary) {
  return {
    id: customer.id,
    profile: customer.profile,
    first_seen_at: customer.firstSeenAt,
    last_seen_at: customer.lastSeenAt,
  };
}

function toCustomerDetailResponse(customer: CustomerDetail) {
  return {
    ...toCustomerResponse(customer),
    purchase_history: customer.purchaseHistory.map((purchase) => ({
      order_id: purchase.orderId,
      currency: purchase.currency,
      total: purchase.totalMinor,
      discount: purchase.discountMinor,
      items: purchase.items,
      completed_at: purchase.completedAt,
    })),
  };
}

function toPaymentResponse(payment: PaymentSummary) {
  return {
    id: payment.id,
    session_id: payment.sessionId,
    amount: payment.amountMinor,
    approved_amount: payment.approvedAmountMinor ?? null,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    provider_reference: payment.providerReference ?? null,
    commerce_order_id: payment.commerceOrderId ?? null,
    status_history: payment.statusHistory,
    created_at: payment.createdAt,
    updated_at: payment.updatedAt,
  };
}
