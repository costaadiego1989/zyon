import type { FederatedProductSnapshot } from "../../domain/ports/federated-product-repository.port.js";
import type { CrossStoreLineItemSnapshot } from "../../domain/ports/cross-store-order-repository.port.js";
import type { MarketplaceConfigSnapshot } from "../../domain/ports/marketplace-config-repository.port.js";
import type { MarketplaceSettlementSnapshot } from "../../domain/ports/marketplace-settlement-repository.port.js";

export class MarketplaceEntityMapper {
  static toProductResponse(product: FederatedProductSnapshot) {
    return {
      id: product.id,
      source_merchant_id: product.sourceMerchantId,
      source_product_id: product.sourceProductId,
      name: product.name,
      description: product.description,
      category: product.category,
      price_cents: product.priceCents,
      currency: product.currency,
      stock_available: product.stockAvailable,
      image_url: product.imageUrl,
      created_at: product.createdAt?.toISOString?.() ?? null,
      synced_at: product.syncedAt?.toISOString?.() ?? null,
    };
  }

  static toLineItemResponse(item: CrossStoreLineItemSnapshot) {
    return {
      id: item.id,
      checkout_session_id: item.checkoutSessionId,
      order_id: item.orderId,
      host_merchant_id: item.hostMerchantId,
      seller_merchant_id: item.sellerMerchantId,
      federated_product_id: item.federatedProductId,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      commission_rate_bps: item.commissionRateBps,
      commission_cents: item.commissionCents,
      seller_net_cents: item.sellerNetCents,
      fulfillment_status: item.fulfillmentStatus,
      fulfillment_reference: item.fulfillmentReference,
      created_at: item.createdAt?.toISOString?.() ?? null,
      updated_at: item.updatedAt?.toISOString?.() ?? null,
    };
  }

  static toConfigResponse(config: MarketplaceConfigSnapshot) {
    return {
      id: config.id,
      merchant_id: config.merchantId,
      enabled: config.enabled,
      commission_rate_bps: config.commissionRateBps,
      return_window_days: config.returnWindowDays,
      payout_delay_days: config.payoutDelayDays,
      chargeback_window_days: config.chargebackWindowDays,
      allowed_categories: config.allowedCategories,
      blocked_merchants: config.blockedMerchants,
      created_at: config.createdAt?.toISOString?.() ?? null,
      updated_at: config.updatedAt?.toISOString?.() ?? null,
    };
  }

  static toSettlementResponse(settlement: MarketplaceSettlementSnapshot) {
    return {
      id: settlement.id,
      host_merchant_id: settlement.hostMerchantId,
      seller_merchant_id: settlement.sellerMerchantId,
      order_id: settlement.orderId,
      line_item_id: settlement.lineItemId,
      total_amount_cents: settlement.totalAmountCents,
      commission_cents: settlement.commissionCents,
      seller_net_cents: settlement.sellerNetCents,
      status: settlement.status,
      return_window_until: settlement.returnWindowUntil?.toISOString?.() ?? null,
      transfer_scheduled_at: settlement.transferScheduledAt?.toISOString?.() ?? null,
      chargeback_window_until: settlement.chargebackWindowUntil?.toISOString?.() ?? null,
      transferred_at: settlement.transferredAt?.toISOString?.() ?? null,
      finalized_at: settlement.finalizedAt?.toISOString?.() ?? null,
      chargeback_at: settlement.chargebackAt?.toISOString?.() ?? null,
      return_at: settlement.returnAt?.toISOString?.() ?? null,
      provider_transfer_id: settlement.providerTransferId,
      created_at: settlement.createdAt?.toISOString?.() ?? null,
      updated_at: settlement.updatedAt?.toISOString?.() ?? null,
    };
  }
}
