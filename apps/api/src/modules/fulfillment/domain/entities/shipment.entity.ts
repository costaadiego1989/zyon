import { randomUUID } from "node:crypto";

export type ShipmentStatus =
  | "created"
  | "label_generated"
  | "dispatched"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "returned"
  | "cancelled";

const LEGAL_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  created: ["label_generated", "cancelled"],
  // A carrier callback is a verified external fact. Melhor Envio does not
  // guarantee delivery of every intermediate lifecycle notification, so a
  // shipment that already has a generated label can converge to its terminal
  // carrier state after an outage without inventing missing tracking events.
  label_generated: ["dispatched", "delivered", "returned", "cancelled"],
  // Melhor Envio exposes `posted` and then `delivered`; it does not guarantee
  // intermediate in-transit/out-for-delivery callbacks. Accepting its direct
  // terminal update preserves a verified carrier fact without fabricating
  // intermediate tracking events.
  dispatched: ["in_transit", "delivered", "returned"],
  in_transit: ["out_for_delivery", "delivered", "returned"],
  out_for_delivery: ["delivered", "returned"],
  delivered: [],
  returned: [],
  cancelled: []
};

export type ShipmentSnapshot = {
  id: string;
  merchant_id: string;
  order_id: string;
  carrier_key: string;
  tracking_code: string | null;
  status: ShipmentStatus;
  label_url: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  estimated_eta: string | null;
  created_at: string;
  updated_at: string;
};

export class ShipmentEntity {
  private constructor(private readonly s: ShipmentSnapshot) {}

  static create(input: { merchant_id: string; order_id: string; carrier_key: string }): ShipmentEntity {
    const now = new Date().toISOString();
    return new ShipmentEntity({
      id: randomUUID(),
      merchant_id: input.merchant_id,
      order_id: input.order_id,
      carrier_key: input.carrier_key,
      tracking_code: null,
      status: "created",
      label_url: null,
      dispatched_at: null,
      delivered_at: null,
      estimated_eta: null,
      created_at: now,
      updated_at: now
    });
  }

  static rehydrate(s: ShipmentSnapshot): ShipmentEntity {
    return new ShipmentEntity(s);
  }

  transition(to: ShipmentStatus): ShipmentEntity {
    const allowed = LEGAL_TRANSITIONS[this.s.status];
    if (!allowed.includes(to)) {
      throw new Error(`INVALID_TRANSITION: ${this.s.status} → ${to}`);
    }
    const now = new Date().toISOString();
    return new ShipmentEntity({
      ...this.s,
      status: to,
      dispatched_at: to === "dispatched" ? now : this.s.dispatched_at,
      delivered_at: to === "delivered" ? now : this.s.delivered_at,
      updated_at: now
    });
  }

  setLabel(labelUrl: string, trackingCode: string): ShipmentEntity {
    return new ShipmentEntity({
      ...this.s,
      label_url: labelUrl,
      tracking_code: trackingCode,
      updated_at: new Date().toISOString()
    });
  }

  setEta(estimatedEta: Date): ShipmentEntity {
    return new ShipmentEntity({ ...this.s, estimated_eta: estimatedEta.toISOString(), updated_at: new Date().toISOString() });
  }

  snapshot(): ShipmentSnapshot { return { ...this.s }; }
  get id(): string { return this.s.id; }
  get merchant_id(): string { return this.s.merchant_id; }
  get status(): ShipmentStatus { return this.s.status; }
}
