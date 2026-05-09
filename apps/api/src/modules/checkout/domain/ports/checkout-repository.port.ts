import type {
  AuthorizedOffer,
  AcceptedOffer,
  ChatTurn,
  CheckoutEventName,
  CheckoutSession,
  CompletedOrder,
  CustomerHints,
  DashboardOverview,
  DomainEventEnvelope,
  MerchantRules
} from "@aacp/shared-types";

// Facade — delegates to split ports. Remove after Wave 2 migration.
/** @deprecated Use CHECKOUT_SESSION_REPOSITORY, OFFER_REPOSITORY, ORDER_REPOSITORY, OUTBOX_REPOSITORY, MERCHANT_RULES_REPOSITORY, BUYER_IDENTITY_REPOSITORY, or DASHBOARD_READ_MODEL instead. */
export const CHECKOUT_REPOSITORY = Symbol("CHECKOUT_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

/** @deprecated God port — splitting into focused ports per Wave 2. */
export interface CheckoutRepository {
  transaction?<T>(work: (repository: CheckoutRepository) => Promise<T>): Promise<T>;
  /** @deprecated Use MerchantRulesRepository.getRules */
  getRules(merchantId: string): MaybePromise<MerchantRules>;
  /** @deprecated Use MerchantRulesRepository.updateRules */
  setRules(merchantId: string, rules: Partial<MerchantRules>): MaybePromise<MerchantRules>;
  /** @deprecated Use BuyerIdentityRepository.resolveGlobalUserId */
  resolveGlobalUserId(merchantId: string, customer?: CustomerHints): MaybePromise<string>;
  /** @deprecated Use CheckoutSessionRepository.saveSession */
  saveSession(session: CheckoutSession): MaybePromise<void>;
  /** @deprecated Use CheckoutSessionRepository.getSession */
  getSession(merchantId: string, sessionId: string): MaybePromise<CheckoutSession | undefined>;
  /** @deprecated Use CheckoutSessionRepository.findSessionsByEmail */
  findSessionsByEmail(merchantId: string, email: string): MaybePromise<CheckoutSession[]>;
  /** @deprecated Use CheckoutSessionRepository.recordEvent */
  recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName): MaybePromise<void>;
  /** @deprecated Use CheckoutSessionRepository.appendChatTurn */
  appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): MaybePromise<CheckoutSession>;
  /** @deprecated Use OfferRepository.saveOffer */
  saveOffer(offer: AuthorizedOffer): MaybePromise<AuthorizedOffer>;
  /** @deprecated Use OfferRepository.getOffer */
  getOffer(merchantId: string, offerId: string): MaybePromise<AuthorizedOffer | undefined>;
  /** @deprecated Use OfferRepository.saveAcceptedOffer */
  saveAcceptedOffer(acceptedOffer: AcceptedOffer): MaybePromise<void>;
  /** @deprecated Use OfferRepository.getAcceptedOffer */
  getAcceptedOffer(merchantId: string, sessionId: string, offerId: string): MaybePromise<AcceptedOffer | undefined>;
  /** @deprecated Use OrderRepository.saveCompletedOrder */
  saveCompletedOrder(order: CompletedOrder): MaybePromise<{ order: CompletedOrder; idempotent: boolean }>;
  /** @deprecated Use OrderRepository.getCompletedOrder */
  getCompletedOrder(merchantId: string, sessionId: string, externalOrderId: string): MaybePromise<CompletedOrder | undefined>;
  /** @deprecated Use OutboxRepository.appendOutbox */
  appendOutbox(event: DomainEventEnvelope): MaybePromise<DomainEventEnvelope>;
  /** @deprecated Use OutboxRepository.listOutbox */
  listOutbox(merchantId: string): MaybePromise<DomainEventEnvelope[]>;
  /** @deprecated Use DashboardReadModel.overview */
  overview(merchantId: string): MaybePromise<DashboardOverview>;
}
