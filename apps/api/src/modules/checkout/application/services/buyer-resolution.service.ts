import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { StartCheckoutRequest } from "@zyon/shared-types";
import { BUYER_IDENTITY_REPOSITORY, type BuyerIdentityRepository } from "../../../buyer-purchase-history/domain/ports/buyer-identity.repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { BUYER_ADDRESS_REPOSITORY, type BuyerAddressRepository } from "../../../buyer-account/domain/ports/buyer-address.port.js";

/** Resolves and hydrates buyer identity, account, and address data for checkout. */
@Injectable()
export class BuyerResolutionService {
  private readonly logger = new Logger(BuyerResolutionService.name);

  constructor(
    @Inject(BUYER_IDENTITY_REPOSITORY) private readonly identity: BuyerIdentityRepository,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyerAccount?: BuyerAccountRepository,
    @Optional() @Inject(BUYER_ADDRESS_REPOSITORY) private readonly buyerAddressRepo?: BuyerAddressRepository
  ) {}

  /**
   * Resolves globalUserId and hydrates buyer data from account and address sources.
   * Returns enriched input with resolved buyer identity and profile data.
   */
  async resolve(input: StartCheckoutRequest): Promise<{ input: StartCheckoutRequest; globalUserId: string }> {
    // Use explicit global_user_id from the widget (authenticated buyer) if provided;
    // otherwise resolve from customer hints (anonymous buyer).
    const globalUserId = (input as any).global_user_id?.trim()
      || await this.identity.resolveGlobalUserId(input.merchant_id, input.customer);

    let enriched = input;

    // Hydrate name/email/phone/cpf from buyer-account. NOTE: address is resolved
    // separately below — the BuyerHub addresses table is the source of truth, so
    // we deliberately do NOT copy the (often stale) account.address inline blob here.
    if (this.buyerAccount && globalUserId && (!input.customer?.fullName || !input.customer?.email || !input.customer?.address?.zip)) {
      try {
        const account = await this.buyerAccount.findByGlobalUserId(globalUserId);
        if (account) {
          enriched = {
            ...enriched,
            customer: {
              ...enriched.customer,
              fullName: enriched.customer?.fullName || account.displayName || undefined,
              email: enriched.customer?.email || account.email || undefined,
              phone: enriched.customer?.phone || account.phone || undefined,
              cpf: enriched.customer?.cpf || (account as any).cpf || undefined,
            },
          };
        }
      } catch (err) {
        this.logger.warn(`buyer-account hydration failed (non-blocking)`, { globalUserId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Resolve address (only when the request didn't carry an explicit one).
    // Priority: BuyerHub saved addresses (source of truth, editable by the buyer)
    // → account.address inline blob (legacy fallback). This prevents a stale
    // onboarding address from overriding what the buyer saved in BuyerHub.
    if (globalUserId && !enriched.customer?.address?.zip) {
      let resolvedAddress: NonNullable<typeof enriched.customer>["address"] | undefined;

      if (this.buyerAddressRepo) {
        try {
          const addresses = await this.buyerAddressRepo.list(globalUserId);
          const defaultAddr = addresses.find((a) => a.isDefault) || addresses[0];
          if (defaultAddr) {
            resolvedAddress = {
              zip: defaultAddr.zip,
              street: defaultAddr.street,
              number: defaultAddr.number,
              complement: defaultAddr.complement,
              neighborhood: defaultAddr.neighborhood,
              city: defaultAddr.city,
              state: defaultAddr.state,
            };
          }
        } catch { /* non-critical — try account fallback below */ }
      }

      // Legacy fallback: inline account.address (pre-BuyerHub buyers).
      if (!resolvedAddress?.zip && this.buyerAccount) {
        try {
          const account = await this.buyerAccount.findByGlobalUserId(globalUserId);
          if (account?.address?.zip) resolvedAddress = account.address;
        } catch { /* non-critical */ }
      }

      if (resolvedAddress?.zip) {
        enriched = { ...enriched, customer: { ...enriched.customer, address: resolvedAddress } };
      }
    }

    return { input: enriched, globalUserId };
  }
}
