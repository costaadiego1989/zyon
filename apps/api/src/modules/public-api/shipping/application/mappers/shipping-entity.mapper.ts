/**
 * Pure mapper functions: shipping domain → v1 API response shape.
 * No side effects, no business logic.
 */
export class ShippingEntityMapper {
  /**
   * ShippingQuoteSnapshot → v1 quote response
   */
  static toShippingQuoteResponse(snapshot: any) {
    return {
      id: snapshot.id,
      session_id: snapshot.session_id,
      merchant_id: snapshot.merchant_id,
      destination_zip: snapshot.destination_zip,
      quote_key: snapshot.quote_key,
      options: (snapshot.results ?? []).map((result: any) => ({
        carrier_key: result.carrier_key,
        label: result.label,
        price_minor: result.price,
        eta_days: result.eta_days,
        is_free: result.is_free,
      })),
      created_at: snapshot.created_at,
      expires_at: snapshot.expires_at,
    };
  }
}
