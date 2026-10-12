import type { MarketplaceCancellationProvider, MarketplaceCancellationRepository } from "../../domain/ports/marketplace-cancellation.port.js";

/** Internal reconciliation; never initiates a cancellation or substitutes a PSP. */
export class ReconcileMarketplaceCancellationUseCase {
  constructor(private readonly repository: MarketplaceCancellationRepository, private readonly provider: MarketplaceCancellationProvider) {}

  async execute(hostMerchantId: string, paymentIntentId: string): Promise<"released" | "pending" | "blocked"> {
    if (!hostMerchantId?.trim() || !paymentIntentId?.trim()) throw new Error("marketplace_cancellation_scope_required");
    const request = await this.repository.request(hostMerchantId, paymentIntentId);
    if (!request || !["stripe", "mercadopago"].includes(request.provider)) return "blocked";
    // Network failures and provider rejection cannot release stock or leak PSP details.
    let evidence;
    try { evidence = await this.provider.readCancellation(request); }
    catch { return "pending"; }
    if (!evidence) return "pending";
    return this.repository.release(evidence);
  }
}
