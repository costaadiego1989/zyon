import type {
  CustomerDetail,
  CustomerSummary,
} from '../../../../operations/domain/ports/operations-read.repository.port.js';
import type {
  CustomerDetailResponse,
  CustomerOrderResponse,
  CustomerSummaryResponse,
} from '../../presentation/http/dtos/customer.dtos.js';

export class CustomerEntityMapper {
  static toCustomerSummaryResponse(
    customer: CustomerSummary,
  ): CustomerSummaryResponse {
    return {
      id: customer.id,
      profile: customer.profile,
      first_seen_at: customer.firstSeenAt,
      last_seen_at: customer.lastSeenAt,
    };
  }

  static toCustomerDetailResponse(
    customer: CustomerDetail,
  ): CustomerDetailResponse {
    return {
      id: customer.id,
      profile: customer.profile,
      first_seen_at: customer.firstSeenAt,
      last_seen_at: customer.lastSeenAt,
      purchase_history: customer.purchaseHistory.map(
        CustomerEntityMapper.toCustomerOrderResponse,
      ),
    };
  }

  static toCustomerOrderResponse(order: {
    orderId: string;
    currency: string;
    totalMinor: number;
    discountMinor: number;
    items: unknown;
    completedAt: string;
  }): CustomerOrderResponse {
    return {
      order_id: order.orderId,
      currency: order.currency,
      total_minor: order.totalMinor,
      discount_minor: order.discountMinor,
      items: order.items,
      completed_at: order.completedAt,
    };
  }
}
