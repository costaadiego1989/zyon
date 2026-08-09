import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../../fulfillment/domain/ports/shipment-repository.port.js";
import { SHIPPING_CARRIER_ADAPTER, type ShippingCarrierPort, type LabelPurchaseInput } from "../../domain/ports/shipping-carrier.port.js";
import { ORDER_TRACKING_UPDATER, type OrderTrackingUpdater } from "../../domain/ports/order-tracking-updater.port.js";

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
  ) {}

  async execute(input: PurchaseShippingLabelInput) {
    const merchantId = required(input.merchantId, "merchant_id");
    const externalOrderId = required(input.externalOrderId, "order_id");

    const label = await this.melhorEnvio.purchaseLabel({
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

    const tracking = await this.melhorEnvio.getTracking(snapshot.tracking_code);
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
