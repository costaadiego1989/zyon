import type { ChatTurn, CheckoutEventName, CheckoutSession, MerchantRules, PaymentMethod } from "@zyon/shared-types";
import type { CheckoutEmailOtpVerificationScope, CheckoutEmailOtpVerificationCommand } from "../services/checkout-email-otp-verification.js";

export const CHECKOUT_SESSION_REPOSITORY = Symbol("CHECKOUT_SESSION_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

/** Server-issued admission, passed separately from the public request body. */
export interface ChatExchangeClaim {
  requestId: string;
  requestHash: string;
}

export interface ChatExchangeInput {
  merchantId: string;
  sessionId: string;
  buyer: ChatTurn;
  agent: ChatTurn;
  expectedSession?: CheckoutSession;
  claim?: ChatExchangeClaim;
  /** Server-derived selection, committed with the conversation; never a charge. */
  selectedPaymentMethod?: PaymentMethod;
}

export interface CheckoutCommercialMutation {
  expected: CheckoutSession;
  next: CheckoutSession;
  /** Buyer-requested cancellation, including its durable lifecycle event. */
  cancel?: boolean;
}

export interface CheckoutSessionRepository {
  /** Actual challenge/account/claim verification, identity CAS and durable
   * acceptance transition in one transaction. Never accepts a verified flag. */
  verifyEmailOtpAndRecognize?(scope: CheckoutEmailOtpVerificationScope, command: CheckoutEmailOtpVerificationCommand,
    claim?: ChatExchangeClaim): Promise<CheckoutSession | undefined>;
  /** Canonical identity pin for profile-only remount hydration. Does not grant
   * or migrate a benefit; undefined is actual absence of NORMAL provenance. */
  readVerifiedNormalBuyerIdentity?(scope: CheckoutEmailOtpVerificationScope,
    expected: { expectedVersion: number; expectedBuyerId: string }): Promise<string | undefined>;
  /** Privacy revocation only: server-generated anonymous UID plus exact public
   * acceptance provenance. Never verifies email or transfers a personal owner. */
  detachNormalBuyerEmail?(scope: CheckoutEmailOtpVerificationScope, command: { expectedVersion: number; email: string },
    claim?: ChatExchangeClaim): Promise<CheckoutSession | undefined>;
  /** Presence-only resume preflight, NOT release proof, ownership or a lease.
   * Dedicated commands must reread/validate receipt, payments and version. */
  hasReleasedStorefrontCouponBinding?(merchantId: string, sessionId: string): MaybePromise<boolean>;
  /** Dedicated canonical coupon revalidation before payment; never a new grant. */
  prepareStorefrontCouponBenefits?(merchantId: string, sessionId: string, method: string): Promise<CheckoutSession | undefined>;
  /** Internal preflight for commands with external side effects. This reads the
   * canonical private storage, not a bit exposed on the public Cart. It is not
   * a lease: issuance/admission still require the common transactional fence. */
  assertCouponBindingCommandAllowed?(merchantId: string, sessionId: string): MaybePromise<void>;
  assertBuyerEditAllowed?(merchantId: string, sessionId: string): Promise<void>;
  /** Buyer editing requires resolved payments, no active chat, and an open order. */
  reopenForBuyerEdit?(merchantId: string, sessionId: string, section: import("@zyon/shared-types").CheckoutEditSection): Promise<CheckoutSession>;
  /** Server payment preparation advances only an already assigned, approved
   * progressive strategy. Browser telemetry cannot authorize a stage. */
  prepareProgressiveIncentivePayment?(merchantId: string, sessionId: string, method: string): Promise<CheckoutSession | undefined>;
  /** Releases only an unused experimental benefit. Caller must return the revised
   * amount for buyer confirmation, never continue charging in the same request. */
  reviseIncentiveForPaymentReview?(merchantId: string, sessionId: string): Promise<CheckoutSession | undefined>;
  /** Saves a current snapshot, invalidates benefits/reservations and records
   * commercial events in one transaction. Never retry with a newer snapshot. */
  commitCommercialMutation?(input: CheckoutCommercialMutation): Promise<CheckoutSession>;
  /** Atomically creates a checkout without replacing an existing buyer/session. */
  createSessionIfAbsent?(session: CheckoutSession): MaybePromise<{ session: CheckoutSession; created: boolean }>;
  /** Persists the server-loaded snapshot; implementations advance its storage
   * token after success. A version conflict must be reread, never blindly retried. */
  saveSession(session: CheckoutSession): MaybePromise<void>;
  /** Persist a prepared snapshot only while its original state is still current. */
  saveSessionIfUnchanged?(session: CheckoutSession, expected: CheckoutSession): MaybePromise<void>;
  /** Authoritative pre-payment benefits. Must serialize with payment admission
   * and leave committed payments / assigned experiment snapshots unchanged. */
  saveBenefitsIfMutable?(session: CheckoutSession, expected: CheckoutSession, authorizedRules: MerchantRules): Promise<CheckoutSession>;
  getSession(merchantId: string, sessionId: string): MaybePromise<CheckoutSession | undefined>;
  findSessionsByEmail(merchantId: string, email: string): MaybePromise<CheckoutSession[]>;
  appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): MaybePromise<CheckoutSession>;
  appendChatExchange(input: ChatExchangeInput): MaybePromise<CheckoutSession>;
  recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName, metadata?: Record<string, unknown>): MaybePromise<void>;
  /**
   * Find sessions where triggerAgent=true and abandonmentScore >= threshold.
   * Used by Cart Recovery scanner to find sessions ready for intervention.
   */
  findSessionsWithTrigger(threshold?: number): MaybePromise<CheckoutSession[]>;
  /**
   * Retrieve all checkout events for a session, ordered chronologically.
   * Used by intent-memory to classify buyer behavior based on session events.
   */
  getSessionEvents(merchantId: string, sessionId: string): MaybePromise<CheckoutEventName[]>;
}
