import type {
  OrderConfirmationEvent,
  OrderShippedEvent,
  OrderDeliveredEvent,
  ReturnApprovedEvent,
} from "../../../../notifications/domain/events/notification.events.js";
import type {
  NotificationSentResponse,
  SendOrderConfirmationDto,
  SendOrderShippedDto,
  SendOrderDeliveredDto,
  SendReturnApprovedDto,
} from "../../presentation/http/dtos/notification.dtos.js";

export class NotificationEntityMapper {
  static toOrderConfirmationEvent(
    merchantId: string,
    dto: SendOrderConfirmationDto,
  ): OrderConfirmationEvent {
    return {
      type: "ORDER_CONFIRMATION",
      merchantId,
      orderId: dto.order_id,
      buyerEmail: dto.recipient_email,
      buyerName: dto.recipient_name,
      buyerPhone: dto.recipient_phone,
      orderNumber: dto.order_number,
      items: dto.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
      total: dto.total,
      currency: dto.currency,
    };
  }

  static toOrderShippedEvent(
    merchantId: string,
    dto: SendOrderShippedDto,
  ): OrderShippedEvent {
    return {
      type: "ORDER_SHIPPED",
      merchantId,
      orderId: dto.order_id,
      buyerEmail: dto.recipient_email,
      buyerName: dto.recipient_name,
      buyerPhone: dto.recipient_phone,
      trackingNumber: dto.tracking_code,
      carrier: dto.carrier,
      estimatedDelivery: dto.estimated_delivery,
    };
  }

  static toOrderDeliveredEvent(
    merchantId: string,
    dto: SendOrderDeliveredDto,
  ): OrderDeliveredEvent {
    return {
      type: "ORDER_DELIVERED",
      merchantId,
      orderId: dto.order_id,
      buyerEmail: dto.recipient_email,
      buyerName: dto.recipient_name,
      buyerPhone: dto.recipient_phone,
    };
  }

  static toReturnApprovedEvent(
    merchantId: string,
    dto: SendReturnApprovedDto,
  ): ReturnApprovedEvent {
    return {
      type: "RETURN_APPROVED",
      merchantId,
      returnId: dto.return_id,
      orderId: dto.order_id,
      buyerEmail: dto.recipient_email,
      buyerName: dto.recipient_name,
      refundAmount: dto.refund_amount,
      currency: dto.currency,
    };
  }

  static toSentResponse(
    notificationType: string,
    orderId: string,
  ): NotificationSentResponse {
    return {
      status: "sent",
      notification_type: notificationType,
      order_id: orderId,
    };
  }
}
