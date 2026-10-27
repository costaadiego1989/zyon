export interface CarrierQuoteInput {
  carrierId: string;
  carrierLabel: string;
  customerPriceCents: number;
  etaHours?: number;
}

/** Tie-break alphabetical carrierId ascending when customerPriceCents ties. */
export function selectCheapestQuote(quotes: CarrierQuoteInput[]): CarrierQuoteInput | null {
  if (quotes.length === 0) {
    return null;
  }
  return quotes.reduce((best, q) => {
    if (q.customerPriceCents < best.customerPriceCents) {
      return q;
    }
    if (q.customerPriceCents > best.customerPriceCents) {
      return best;
    }
    return q.carrierId < best.carrierId ? q : best;
  });
}
