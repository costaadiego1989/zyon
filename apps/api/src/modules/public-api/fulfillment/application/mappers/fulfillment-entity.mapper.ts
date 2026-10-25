/**
 * Fulfillment Entity Mapper
 *
 * Converts domain entities to API response DTOs.
 * All response fields use snake_case per API convention.
 */
export class FulfillmentEntityMapper {
  /**
   * Map shipment snapshot to v1 list response item.
   */
  static toShipmentSummaryResponse(snapshot: any) {
    return {
      id: snapshot.id,
      order_id: snapshot.order_id,
      carrier: snapshot.carrier_key,
      tracking_code: snapshot.tracking_code,
      status: snapshot.status,
      label_url: snapshot.label_url,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    };
  }

  /**
   * Map shipment snapshot to v1 detail response.
   */
  static toShipmentDetailResponse(snapshot: any) {
    return {
      id: snapshot.id,
      order_id: snapshot.order_id,
      carrier: snapshot.carrier_key,
      tracking_code: snapshot.tracking_code,
      status: snapshot.status,
      label_url: snapshot.label_url,
      estimated_eta: snapshot.estimated_eta,
      delivered_at: snapshot.delivered_at,
      dispatched_at: snapshot.dispatched_at,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    };
  }

  /**
   * Map shipment entity to create response.
   */
  static toCreateShipmentResponse(snapshot: any) {
    return {
      shipment_id: snapshot.id,
      order_id: snapshot.order_id,
      carrier: snapshot.carrier_key,
      status: snapshot.status,
      created_at: snapshot.created_at,
    };
  }
}
