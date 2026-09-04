import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import type { BuyerAccount } from "../../../buyer-account/domain/entities/buyer-account.entity.js";

/**
 * Handles returning buyer recognition: finding prior sessions/accounts,
 * merging profiles, and resolving global_user_id.
 * Extracted from CheckoutCustomerService to satisfy SRP.
 *
 * Single responsibility: buyer identity recognition and profile merge.
 * Does NOT handle OTP, persistence, or email notifications.
 */
@Injectable()
export class BuyerRecognitionService {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly repository: CheckoutSessionRepository,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyerAccounts?: BuyerAccountRepository
  ) {}

  /**
   * Look up a returning buyer by email.
   * Returns { account, previousSession } for either or both sources.
   */
  async findReturningBuyerByEmail(
    email: string,
    merchantId: string,
    currentSessionId: string
  ): Promise<{
    account: BuyerAccount | null;
    previousSession: CheckoutSession | null;
    isReturning: boolean;
    globalUserId: string | undefined;
  }> {
    const existingAccount = await this.buyerAccounts?.findByEmail(email) ?? null;
    const priorSessions = await this.repository.findSessionsByEmail(merchantId, email);
    const previousSession = this.pickBestPriorSession(priorSessions, currentSessionId);
    const isReturning = Boolean(existingAccount || previousSession);

    const priorEmailVerified = Boolean(
      existingAccount ||
      (previousSession?.customer?.email_verified &&
        previousSession.customer.email?.toLowerCase() === email.toLowerCase())
    );

    let globalUserId: string | undefined;
    if (existingAccount?.globalUserId) {
      globalUserId = existingAccount.globalUserId;
    } else if (previousSession?.globalUserId) {
      globalUserId = previousSession.globalUserId;
    }

    return { account: existingAccount, previousSession, isReturning, globalUserId };
  }

  /**
   * Hydrate a verified buyer's profile from account + prior session data.
   * Returns a patch to merge into the session's customer hints.
   */
  buildRecognizedProfilePatch(
    current: CustomerHints | undefined,
    account: BuyerAccount | null,
    priorCustomer?: CustomerHints
  ): Partial<CustomerHints> {
    const phone = current?.phone ?? account?.phone ?? priorCustomer?.phone;
    const address = this.pickBestAddress(current?.address, account?.address, priorCustomer?.address);
    return {
      recognized_buyer: true,
      isReturning: true,
      fullName: current?.fullName ?? account?.displayName ?? priorCustomer?.fullName,
      phone,
      phone_verified: Boolean(
        current?.phone_verified ||
        priorCustomer?.phone_verified ||
        (phone && account?.phone)
      ),
      cpf: current?.cpf ?? account?.cpf ?? priorCustomer?.cpf,
      address,
      address_verified:
        current?.address_verified ??
        priorCustomer?.address_verified ??
        Boolean(this.isCompleteAddress(account?.address) || this.isCompleteAddress(priorCustomer?.address))
    };
  }

  /**
   * Recognize and hydrate a verified buyer on session.
   * Merges account + prior session profile into the current session.
   * Returns the updated session or the same session if no recognized buyer.
   */
  async recognizeVerifiedBuyer(
    session: CheckoutSession,
    mergeCustomers: (session: CheckoutSession, patch: Partial<CustomerHints>) => CheckoutSession
  ): Promise<{
    session: CheckoutSession;
    globalUserId: string | undefined;
  }> {
    const email = session.customer?.email?.trim().toLowerCase();
    if (!email) return { session, globalUserId: undefined };

    const account = await this.buyerAccounts?.findByEmail(email) ?? null;
    const priorSessions = await this.repository.findSessionsByEmail(session.merchantId, email);
    const previousSession = this.pickBestPriorSession(priorSessions, session.sessionId);
    if (!account && !previousSession) return { session, globalUserId: undefined };

    const patch = this.buildRecognizedProfilePatch(session.customer, account, previousSession?.customer);
    const updatedSession = mergeCustomers(session, patch);

    const recognizedGlobalUserId = account?.globalUserId ?? previousSession?.globalUserId;

    return { session: updatedSession, globalUserId: recognizedGlobalUserId };
  }

  /**
   * Check if a prior email was verified (allows skipping new OTP send).
   */
  isPriorEmailVerified(
    email: string,
    account: BuyerAccount | null,
    previousSession: CheckoutSession | null
  ): boolean {
    return Boolean(
      account ||
      (previousSession?.customer?.email_verified &&
        previousSession.customer.email?.toLowerCase() === email.toLowerCase())
    );
  }

  /**
   * Profile completeness score for ranking prior sessions.
   */
  profileCompletenessScore(customer?: CustomerHints): number {
    if (!customer) return 0;
    let score = 0;
    if (customer.fullName) score += 2;
    if (customer.email_verified) score += 1;
    if (customer.cpf) score += 2;
    if (customer.phone) score += 1;
    if (customer.phone_verified) score += 2;
    if (customer.address?.zip) score += 1;
    if (customer.address?.street) score += 1;
    if (customer.address?.number) score += 1;
    if (customer.address?.complement !== undefined) score += 1;
    if (customer.address_verified) score += 1;
    if (this.isCompleteAddress(customer.address)) score += 3;
    return score;
  }

  private pickBestPriorSession(
    sessions: CheckoutSession[],
    currentSessionId: string
  ): CheckoutSession | null {
    return sessions
      .filter((session) => session.sessionId !== currentSessionId)
      .sort((a, b) => {
        const scoreDiff = this.profileCompletenessScore(b.customer) - this.profileCompletenessScore(a.customer);
        if (scoreDiff !== 0) return scoreDiff;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      })[0] ?? null;
  }

  private pickBestAddress(
    current?: CustomerHints["address"],
    account?: CustomerHints["address"],
    previous?: CustomerHints["address"]
  ): CustomerHints["address"] | undefined {
    for (const candidate of [current, account, previous]) {
      if (this.isCompleteAddress(candidate)) return candidate;
    }
    const merged = {
      ...(previous ?? {}),
      ...(account ?? {}),
      ...(current ?? {})
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  isCompleteAddress(address?: CustomerHints["address"]): boolean {
    return Boolean(
      address?.zip &&
      address.street &&
      address.city &&
      address.state &&
      address.number &&
      address.complement !== undefined
    );
  }
}
