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
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
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
  @ApiOperation({
    summary: "List orders",
    description: "Retrieves paginated list of orders for the merchant. Supports cursor-based pagination. Orders progress through lifecycle: pending → processing → fulfilled or cancelled.",
  })
  @ApiQuery({ name: "limit", type: "string", required: false, description: "Items per page (default: 10)" })
  @ApiQuery({ name: "cursor", type: "string", required: false, description: "Pagination cursor for next page" })
  @ApiResponse({
    status: 200,
    description: "Orders retrieved successfully",
    schema: {
      properties: {
        data: {
          type: "array",
          items: { $ref: "#/components/schemas/Order" },
        },
        next_cursor: { type: "string", nullable: true },
        has_more: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
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
  @ApiOperation({
    summary: "Create order from payment",
    description: "Creates a new order from an existing approved payment. Used when payment is approved through an external channel and needs order record.",
  })
  @ApiBody({
    schema: {
      properties: {
        payment_id: { type: "string", description: "ID of approved payment" },
      },
      required: ["payment_id"],
    },
  })
  @ApiResponse({
    status: 201,
    description: "Order created successfully",
    schema: { $ref: "#/components/schemas/OrderDetail" },
  })
  @ApiResponse({ status: 400, description: "Invalid payment_id or payment not approved" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Payment not found" })
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
  @ApiOperation({
    summary: "Get order details",
    description: "Retrieves full order details including timeline events, customer info, cart items, and any applied offers.",
  })
  @ApiParam({ name: "orderId", type: "string", description: "Order ID" })
  @ApiResponse({
    status: 200,
    description: "Order retrieved successfully",
    schema: { $ref: "#/components/schemas/OrderDetail" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Order not found" })
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
  @ApiOperation({
    summary: "Cancel order",
    description: "Cancels an order with optional customer notification and inventory restock. Updates order status to 'cancelled' and records cancellation reason.",
  })
  @ApiParam({ name: "orderId", type: "string", description: "Order ID to cancel" })
  @ApiBody({
    schema: {
      properties: {
        reason: { type: "string", description: "Reason for cancellation" },
        notify_customer: { type: "boolean", description: "Send cancellation notification to customer" },
        restock: { type: "boolean", description: "Return items to inventory" },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Order cancelled successfully",
    schema: { properties: { cancelled: { type: "boolean" } } },
  })
  @ApiResponse({ status: 400, description: "Cannot cancel order in current status" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Order not found" })
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
  @ApiOperation({
    summary: "Update order status",
    description: "Updates order status in the lifecycle: pending → processing → fulfilled (or cancelled at any stage). Invalid transitions are rejected.",
  })
  @ApiParam({ name: "orderId", type: "string", description: "Order ID" })
  @ApiBody({
    schema: {
      properties: {
        status: { type: "string", enum: ["pending", "processing", "fulfilled", "cancelled"] },
      },
      required: ["status"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Status updated successfully",
    schema: { properties: { status: { type: "string" } } },
  })
  @ApiResponse({ status: 400, description: "Invalid status transition" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Order not found" })
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
  @ApiOperation({
    summary: "Get order timeline",
    description: "Retrieves all lifecycle events for an order (status changes, payment events, tracking events) in chronological order.",
  })
  @ApiParam({ name: "orderId", type: "string", description: "Order ID" })
  @ApiResponse({
    status: 200,
    description: "Timeline retrieved successfully",
    schema: { properties: { data: { type: "array" } } },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Order not found" })
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  async timeline(
    @Req() request: unknown,
    @Param("orderId") orderId: string,
  ) {
    const order = await this.getOrder.execute(tenantId(request), orderId);
    return { data: order.timeline };
  }

  @Get(":orderId/tracking")
  @ApiOperation({
    summary: "Get order tracking info",
    description: "Retrieves shipment tracking information for the order, including tracking code and tracking-specific timeline events.",
  })
  @ApiParam({ name: "orderId", type: "string", description: "Order ID" })
  @ApiResponse({
    status: 200,
    description: "Tracking info retrieved successfully",
    schema: {
      properties: {
        order_id: { type: "string" },
        external_order_id: { type: "string" },
        tracking_code: { type: "string", nullable: true },
        timeline: { type: "array" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Order not found" })
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
  @ApiOperation({
    summary: "Update order tracking",
    description: "Updates shipment tracking information including tracking code, carrier, URL, delivery status, and tracking events.",
  })
  @ApiParam({ name: "orderId", type: "string", description: "Order ID" })
  @ApiResponse({
    status: 200,
    description: "Tracking updated successfully",
    schema: {
      properties: {
        updated: { type: "boolean" },
        changed: { type: "boolean" },
        order_id: { type: "string" },
        external_order_id: { type: "string" },
        tracking_code: { type: "string", nullable: true },
        shipment: { type: "object" },
        events_recorded: { type: "number" },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid tracking data" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Order not found" })
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
  @ApiOperation({
    summary: "List customers",
    description: "Retrieves paginated list of customers with profile data and first/last seen timestamps. Supports cursor-based pagination.",
  })
  @ApiQuery({ name: "limit", type: "string", required: false, description: "Items per page (default: 10)" })
  @ApiQuery({ name: "cursor", type: "string", required: false, description: "Pagination cursor for next page" })
  @ApiResponse({
    status: 200,
    description: "Customers retrieved successfully",
    schema: {
      properties: {
        data: { type: "array" },
        next_cursor: { type: "string", nullable: true },
        has_more: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
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
  @ApiOperation({
    summary: "Get customer details",
    description: "Retrieves full customer profile including purchase history for this merchant.",
  })
  @ApiParam({ name: "customerId", type: "string", description: "Customer ID" })
  @ApiResponse({
    status: 200,
    description: "Customer retrieved successfully",
    schema: { $ref: "#/components/schemas/CustomerDetail" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Customer not found" })
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
  @ApiOperation({
    summary: "List payments",
    description: "Retrieves paginated list of payments with status, amount, provider reference, and method info. Supports cursor-based pagination.",
  })
  @ApiQuery({ name: "limit", type: "string", required: false, description: "Items per page (default: 10)" })
  @ApiQuery({ name: "cursor", type: "string", required: false, description: "Pagination cursor for next page" })
  @ApiResponse({
    status: 200,
    description: "Payments retrieved successfully",
    schema: {
      properties: {
        data: { type: "array" },
        next_cursor: { type: "string", nullable: true },
        has_more: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
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
  @ApiOperation({
    summary: "Get payment details",
    description: "Retrieves payment details including amount, status, method, provider reference, and full status history.",
  })
  @ApiParam({ name: "paymentId", type: "string", description: "Payment ID" })
  @ApiResponse({
    status: 200,
    description: "Payment retrieved successfully",
    schema: { $ref: "#/components/schemas/PaymentSummary" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Payment not found" })
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
