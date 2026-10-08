import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../../fulfillment/domain/ports/shipment-repository.port.js";
import { SHIPPING_CARRIER_ADAPTER, type ShippingCarrierPort, type LabelPurchaseInput } from "../../domain/ports/shipping-carrier.port.js";
import { ORDER_TRACKING_UPDATER, type OrderTrackingUpdater } from "../../domain/ports/order-tracking-updater.port.js";
import { MarketplaceLabelPurchaseGuard } from "./marketplace-label-purchase.guard.js";

export type PurchaseShippingLabelInput = {
  merchantId: string;
  externalOrderId: string;
  serviceId: number;
  fromZip: string;
  toZip: string;
  toName: string;
  toDocument: string;
  packages: LabelPurchaseInput["packages"];
  invoiceKey?: string;
};

@Injectable()
export class PurchaseShippingLabelUseCase {
  constructor(
    @Inject(SHIPPING_CARRIER_ADAPTER) private readonly melhorEnvio: ShippingCarrierPort,
    @Inject(ORDER_TRACKING_UPDATER) private readonly updateTracking: OrderTrackingUpdater,
    @Inject(MarketplaceLabelPurchaseGuard) private readonly marketplaceGuard: Pick<MarketplaceLabelPurchaseGuard, "assertOrdinaryOrder">,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  async execute(input: PurchaseShippingLabelInput) {
    const merchantId = required(input.merchantId, "merchant_id");
    const externalOrderId = required(input.externalOrderId, "order_id");

    // A carrier purchase is an irreversible external charge. Verify that the
    // order belongs to this tenant before asking the carrier to issue a label.
    await this.updateTracking.assertOrderExists({ merchantId, externalOrderId });
    await this.marketplaceGuard.assertOrdinaryOrder({ merchantId, externalOrderId });

    const label = await this.melhorEnvio.purchaseLabel({
      merchantId,
      serviceId: input.serviceId,
      fromZip: input.fromZip,
      toZip: input.toZip,
      toName: input.toName,
      toDocument: input.toDocument,
      packages: input.packages,
      invoiceKey: input.invoiceKey,
    });

    const update = await this.updateTracking.execute({
      merchantId,
      externalOrderId,
      body: {
        tracking_code: label.trackingCode,
        carrier: "melhor-envio",
        tracking_url: label.labelUrl,
        status: "label_generated",
        events: [{
          status: "label_generated",
          description: "Etiqueta Melhor Envio gerada",
          occurred_at: new Date().toISOString(),
          carrier_raw: { purchase_id: label.purchaseId },
        }],
      },
    });

    // This id namespace is written only by native label purchases. Generic
    // tracking integrations generate their own ids and cannot supply this id.
    if (this.prisma && label.carrierOrderId && label.accountIdentity) {
      const shipment = await this.prisma.shipment.findFirst({ where: { merchantId, externalOrderId, trackingCode: label.trackingCode } });
      if (!shipment) throw new BadRequestException("shipping_label_original_shipment_missing");
      const id = `shipping_label_purchase_${createHash("sha256").update(JSON.stringify([merchantId, shipment.id, label.carrierOrderId])).digest("hex")}`;
      await this.prisma.trackingEvent.upsert({ where: { id }, update: {}, create: { id, merchantId, shipmentId: shipment.id,
        trackingCode: label.trackingCode, status: "label_generated", description: "Etiqueta comprada na conta Melhor Envio da loja",
        occurredAt: new Date(), carrierRaw: { kind: "zyon_native_label_purchase", carrier_order_id: label.carrierOrderId,
          account_identity: label.accountIdentity, purchase_id: label.purchaseId, external_order_id: externalOrderId } } });
    }

    return {
      purchase_id: label.purchaseId,
      tracking_code: label.trackingCode,
      label_url: label.labelUrl ?? null,
      update,
    };
  }
}

@Injectable()
export class GetShippingTrackingUseCase {
  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly shipments: ShipmentRepository,
    @Inject(SHIPPING_CARRIER_ADAPTER) private readonly melhorEnvio: ShippingCarrierPort,
  ) {}

  async execute(input: { merchantId: string; shipmentId: string }) {
    const merchantId = required(input.merchantId, "merchant_id");
    const shipmentId = required(input.shipmentId, "shipment_id");
    const shipment = await this.shipments.findById(shipmentId, merchantId);
    if (!shipment) throw new NotFoundException("shipment_not_found");
    const snapshot = shipment.snapshot();
    if (!snapshot.tracking_code) throw new BadRequestException("tracking_code_missing");

    const tracking = await this.melhorEnvio.getTracking(snapshot.tracking_code, merchantId);
    return {
      shipment_id: snapshot.id,
      order_id: snapshot.order_id,
      tracking_code: snapshot.tracking_code,
      status: tracking.status,
      events: tracking.events,
    };
  }
}

function required(value: string, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(`${code}_required`);
  return normalized;
}
