import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { BuyerAccount } from "../../../buyer-account/domain/entities/buyer-account.entity.js";

/**
 * Handles buyer account persistence: creating or updating buyer accounts
 * when registration is complete or email is verified.
 * Extracted from CheckoutCustomerService to satisfy SRP.
 *
 * Single responsibility: buyer account lifecycle in the persistence layer.
 * Does NOT handle OTP, recognition, or email notifications.
 */
@Injectable()
export class BuyerAccountPersistenceService {
  constructor(
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyerAccounts?: BuyerAccountRepository
  ) {}

  /**
   * Check if the customer registration is complete (all required fields present).
   */
  isRegistrationComplete(customer?: CustomerHints): boolean {
    return Boolean(
      customer?.fullName &&
      customer.email &&
      customer.email_verified &&
      customer.cpf &&
      customer.phone &&
      customer.phone_verified
    );
  }

  /**
   * Ensure the buyer account is persisted (created or updated).
   * Called after email verification or after full registration.
   *
   * @param session The checkout session with customer data.
   * @param emailVerifiedOnly When true, only persist if email is verified (skip full registration check).
   */
  async ensureBuyerAccountPersisted(session: CheckoutSession, emailVerifiedOnly = false): Promise<void> {
    if (!this.buyerAccounts) return;

    const customer = session.customer;
    if (!customer?.email) return;

    if (!emailVerifiedOnly && !this.isRegistrationComplete(customer)) return;
    if (emailVerifiedOnly && !customer.email_verified) return;

    const email = customer.email.trim().toLowerCase();
    const existing = await this.buyerAccounts.findByEmail(email);
    if (existing) {
      const hydrated = existing.withUpdatedProfile(
        customer.fullName,
        customer.phone,
        customer.address,
        customer.cpf
      );
      if (hydrated !== existing) await this.buyerAccounts.save(hydrated);
      return;
    }

    const now = new Date();
    await this.buyerAccounts.save(
      new BuyerAccount({
        globalUserId: session.globalUserId,
        email,
        passwordHash: `checkout-auto:${session.globalUserId}`,
        displayName: customer.fullName ?? email.split("@")[0]!,
        phone: customer.phone,
        cpf: customer.cpf,
        address: customer.address,
        createdAt: now,
        updatedAt: now
      })
    );
  }
}
