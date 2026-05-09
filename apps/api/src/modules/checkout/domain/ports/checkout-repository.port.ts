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

export const CHECKOUT_REPOSITORY = Symbol("CHECKOUT_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface CheckoutRepository {
  transaction?<T>(work: (repository: CheckoutRepository) => Promise<T>): Promise<T>;
  getRules(merchantId: string): MaybePromise<MerchantRules>;
  setRules(merchantId: string, rules: Partial<MerchantRules>): MaybePromise<MerchantRules>;
  resolveGlobalUserId(merchantId: string, customer?: CustomerHints): MaybePromise<string>;
  saveSession(session: CheckoutSession): MaybePromise<CheckoutSession>;
  getSession(merchantId: string, sessionId: string): MaybePromise<CheckoutSession | undefined>;
  findSessionsByEmail(merchantId: string, email: string): MaybePromise<CheckoutSession[]>;
  recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName): MaybePromise<void>;
  appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): MaybePromise<CheckoutSession>;
  saveOffer(offer: AuthorizedOffer): MaybePromise<AuthorizedOffer>;
  getOffer(merchantId: string, offerId: string): MaybePromise<AuthorizedOffer | undefined>;
  saveAcceptedOffer(acceptedOffer: AcceptedOffer): MaybePromise<AcceptedOffer>;
  getAcceptedOffer(merchantId: string, sessionId: string, offerId: string): MaybePromise<AcceptedOffer | undefined>;
  saveCompletedOrder(order: CompletedOrder): MaybePromise<{ order: CompletedOrder; idempotent: boolean }>;
  getCompletedOrder(merchantId: string, sessionId: string, externalOrderId: string): MaybePromise<CompletedOrder | undefined>;
  appendOutbox(event: DomainEventEnvelope): MaybePromise<DomainEventEnvelope>;
  listOutbox(merchantId: string): MaybePromise<DomainEventEnvelope[]>;
  overview(merchantId: string): MaybePromise<DashboardOverview>;
}
