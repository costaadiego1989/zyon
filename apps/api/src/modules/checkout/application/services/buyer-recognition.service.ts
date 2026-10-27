import { Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import type { BuyerAccount } from "../../../buyer-account/domain/entities/buyer-account.entity.js";
import { buyerProfileCompletenessScore, isCompleteBuyerAddress, pickBestPriorCheckoutBuyer } from "../../domain/services/buyer-recognition.js";

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
    const previousSession = this.pickBestPriorSession(priorSessions, currentSessionId, email);
    const isReturning = Boolean(existingAccount || previousSession);

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
        (phone && phone === priorCustomer?.phone && priorCustomer.phone_verified)
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
    mergeCustomers: (session: CheckoutSession, patch: Partial<CustomerHints>) => CheckoutSession,
    trustedGlobalUserId?: string,
  ): Promise<{
    session: CheckoutSession;
    globalUserId: string | undefined;
  }> {
    const email = session.customer?.email?.trim().toLowerCase();
    if (!email || session.customer?.email_verified !== true) {
      return { session, globalUserId: undefined };
    }

    const account = await this.buyerAccounts?.findByEmail(email) ?? null;
    if (trustedGlobalUserId !== undefined && account && account.globalUserId !== trustedGlobalUserId) {
      throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
    }
    const priorSessions = await this.repository.findSessionsByEmail(session.merchantId, email);
    const candidates = trustedGlobalUserId === undefined ? priorSessions : priorSessions.filter(prior =>
      prior.globalUserId === trustedGlobalUserId && prior.merchantId === session.merchantId);
    const previousSession = this.pickBestPriorSession(candidates, session.sessionId, email);
    if (!account && !previousSession) return { session, globalUserId: undefined };

    const patch = this.buildRecognizedProfilePatch(session.customer, account, previousSession?.customer);
    const updatedSession = mergeCustomers(session, patch);

    const recognizedGlobalUserId = account?.globalUserId ?? previousSession?.globalUserId;

    return { session: updatedSession, globalUserId: recognizedGlobalUserId };
  }

  /**
   * Profile completeness score for ranking prior sessions.
   */
  profileCompletenessScore(customer?: CustomerHints): number {
    return buyerProfileCompletenessScore(customer);
  }

  private pickBestPriorSession(
    sessions: CheckoutSession[],
    currentSessionId: string,
    email: string,
  ): CheckoutSession | null {
    return pickBestPriorCheckoutBuyer(sessions, currentSessionId, email);
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
    return isCompleteBuyerAddress(address);
  }
}
