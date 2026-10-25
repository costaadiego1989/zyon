import Stripe from "stripe";
import { createHash } from "node:crypto";
import type { MarketplaceCancellationEvidence, MarketplaceCancellationProvider, MarketplaceCancellationRequest } from "../domain/ports/marketplace-cancellation.port.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import type { MarketplaceCancellationExecutionProvider, MarketplaceCancellationExecutionRequest, MarketplaceCancellationObservation } from "../domain/ports/marketplace-cancellation-execution.port.js";
import { fundingHash } from "./repositories/prisma-marketplace-funding.repository.js";

/** Cancellation requires a journal; the existing readCancellation remains GET only. */
export class MarketplaceCancellationAdapter implements MarketplaceCancellationProvider, MarketplaceCancellationExecutionProvider {
  private readonly stripe?: Stripe;
  constructor(private readonly config: { stripeSecret?: string; asaasKey?: string; asaasOrigin?: string; mercadoPago?: {
    accessToken?: string; baseUrl: string; environment: "test" | "live";
  } }, private readonly request: typeof fetch = globalThis.fetch) {
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }

  async readCancellation(input: MarketplaceCancellationRequest): Promise<MarketplaceCancellationEvidence | null> {
    if (input.provider === "mercadopago") {
      this.mercadoPagoAccount(input);
      const payment = await this.mercadoPagoPayment(input);
      return payment && this.mercadoPagoEvidence(input, payment);
    }
    if (input.provider !== "stripe") return null;
    if (!input.hostMerchantId?.trim() || !input.paymentIntentId?.trim() || !input.instructionsHash?.trim() ||
        !/^pi_[A-Za-z0-9_]+$/.test(input.providerPaymentId) || input.currency !== "BRL" ||
        !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 2_147_483_647) {
      throw new Error("marketplace_cancellation_request_invalid");
    }
    const account = marketplaceCaptureAccount("stripe", input.environment, this.config.stripeSecret);
    if (account.accountFingerprint !== input.accountFingerprint) throw new Error("marketplace_cancellation_account_mismatch");
    const payment = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId);
    if (payment.id !== input.providerPaymentId || payment.status !== "canceled" || payment.amount !== input.amountCents ||
        payment.amount_received !== 0 || payment.amount_capturable !== 0 || payment.currency !== "brl" ||
        payment.livemode !== (input.environment === "live") || payment.transfer_data || payment.application_fee_amount ||
        payment.on_behalf_of || !Number.isSafeInteger(payment.canceled_at) || payment.canceled_at! <= 0 ||
        payment.canceled_at! * 1000 > Date.now() + 60_000) return null;
    return { ...input, provider: "stripe", state: "terminal_uncaptured", amountReceivedCents: 0, amountCapturableCents: 0,
      cancelledAt: new Date(payment.canceled_at! * 1000).toISOString(), observedAt: new Date().toISOString() };
  }

  async submitCancellation(input: MarketplaceCancellationExecutionRequest): Promise<{ state: "unknown" }> {
    this.executionRequest(input);
    if (input.provider === "asaas") {
      try {
        const payment = await this.asaasPayment(input);
        // Pending Pix/boleto only. A deleted payment, paid charge, uncertain
        // response or incompatible source resource cannot trigger another write.
        if (!payment || !this.asaasUncaptured(payment) || payment.deleted !== false) return { state: "unknown" };
        await this.asaasRead(input, "DELETE");
      } catch { /* The durable claim remains unknown, even after a lost response. */ }
      return { state: "unknown" };
    }
    if (input.provider === "mercadopago") {
      try {
        const payment = await this.mercadoPagoPayment(input);
        if (!payment || !this.mercadoPagoZero(payment) || !["pending", "in_process", "authorized"].includes(payment.status)) return { state: "unknown" };
        // The Payments API cancels with PUT, never DELETE. Its response cannot
        // release anything; a later GET must independently prove the terminal state.
        await this.mercadoPagoRead(`/v1/payments/${input.providerPaymentId}`, {
          method: "PUT", headers: { "Content-Type": "application/json", "X-Idempotency-Key": input.reference },
          body: JSON.stringify({ status: "cancelled" }),
        });
      } catch { /* Any timeout or rejection remains admitted unknown. No retry. */ }
      return { state: "unknown" };
    }
    // An existing, exact platform PI is checked before the only possible mutation.
    // processing is intentionally excluded: Stripe allows it only for some methods.
    let payment: Stripe.PaymentIntent;
    try { payment = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId); }
    catch { return { state: "unknown" }; }
    if (!this.matches(input, payment) || payment.amount_received !== 0 ||
        !["requires_payment_method", "requires_action", "requires_confirmation", "requires_capture"].includes(payment.status) ||
        payment.amount_capturable !== (payment.status === "requires_capture" ? input.amountCents : 0)) return { state: "unknown" };
    try {
      await this.stripe!.paymentIntents.cancel(input.providerPaymentId,
        { cancellation_reason: input.cancellationReason }, { idempotencyKey: input.reference });
    } catch { /* All POST outcomes require an independent read. Never retry here. */ }
    return { state: "unknown" };
  }

  async reconcileCancellation(input: MarketplaceCancellationExecutionRequest): Promise<MarketplaceCancellationObservation> {
    this.executionRequest(input);
    if (input.provider === "asaas") {
      const payment = await this.asaasPayment(input);
      if (!payment) return { state: "unknown" };
      if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"].includes(payment.status)) {
        return { state: "blocked", reason: "marketplace_cancellation_capture_observed", requestHash: input.requestHash,
          providerPaymentId: input.providerPaymentId, amountReceivedCents: input.amountCents, observedAt: new Date().toISOString() };
      }
      if (!this.asaasUncaptured(payment) || typeof payment.deleted !== "boolean") return { state: "unknown" };
      return { state: "unknown", asaas: { requestHash: input.requestHash, providerPaymentId: input.providerPaymentId,
        customerId: input.asaasCustomerId, billingType: input.asaasBillingType, amountCents: input.amountCents,
        status: payment.status, state: payment.deleted ? "removed_reversible" : "active_uncaptured", observedAt: new Date().toISOString() } };
    }
    if (input.provider === "mercadopago") {
      const payment = await this.mercadoPagoPayment(input);
      if (!payment) return { state: "unknown" };
      const received = this.mercadoPagoCents(payment.transaction_details?.net_received_amount);
      if (received !== null && received > 0 && received <= input.amountCents) return {
        state: "blocked", reason: "marketplace_cancellation_capture_observed", requestHash: input.requestHash,
        providerPaymentId: input.providerPaymentId, amountReceivedCents: received, observedAt: new Date().toISOString(),
      };
      const { version: _version, cancellationReason: _reason, reference: _reference, requestHash: _hash, ...request } = input;
      const evidence = this.mercadoPagoEvidence(request, payment);
      return evidence ? { state: "confirmed", evidence } : { state: "unknown" };
    }
    const payment = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId);
    if (!this.matches(input, payment)) return { state: "unknown" };
    if (Number.isSafeInteger(payment.amount_received) && payment.amount_received > 0 && payment.amount_received <= input.amountCents) {
      return { state: "blocked", reason: "marketplace_cancellation_capture_observed", requestHash: input.requestHash,
        providerPaymentId: input.providerPaymentId, amountReceivedCents: payment.amount_received, observedAt: new Date().toISOString() };
    }
    if (payment.status !== "canceled" || payment.amount_received !== 0 || payment.amount_capturable !== 0 ||
        !Number.isSafeInteger(payment.canceled_at) || payment.canceled_at! <= 0 || payment.canceled_at! * 1000 > Date.now() + 60_000) return { state: "unknown" };
    const { version: _version, checkoutSessionId: _session, cancellationReason: _reason, reference: _reference, requestHash: _hash, ...request } = input;
    return { state: "confirmed", evidence: { ...request, provider: "stripe", state: "terminal_uncaptured",
      amountReceivedCents: 0, amountCapturableCents: 0, cancelledAt: new Date(payment.canceled_at! * 1000).toISOString(), observedAt: new Date().toISOString() } };
  }

  private executionRequest(input: MarketplaceCancellationExecutionRequest) {
    const { requestHash, ...body } = input;
    if (!(input.provider === "asaas" ? input.version === 2 && /^cus_[A-Za-z0-9_-]+$/.test(input.asaasCustomerId) &&
          ["PIX", "BOLETO"].includes(input.asaasBillingType) : input.version === 1 && ["stripe", "mercadopago"].includes(input.provider)) ||
        !input.hostMerchantId?.trim() || !input.paymentIntentId?.trim() ||
        !input.checkoutSessionId?.trim() || !/^[a-f0-9]{64}$/.test(input.instructionsHash) ||
        !(input.provider === "mercadopago" ? /^[1-9][0-9]*$/ : input.provider === "asaas" ? /^pay_[A-Za-z0-9_-]+$/ : /^pi_[A-Za-z0-9_]+$/).test(input.providerPaymentId) || input.currency !== "BRL" ||
        !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 2_147_483_647 ||
        !["requested_by_customer", "abandoned", "duplicate", "fraudulent"].includes(input.cancellationReason) ||
        input.reference !== `mcancel_${fundingHash([input.hostMerchantId, input.paymentIntentId, input.instructionsHash])}` ||
        !/^[a-f0-9]{64}$/.test(requestHash) || fundingHash(body) !== requestHash) throw new Error("marketplace_cancellation_request_invalid");
    if (input.provider === "mercadopago") { this.mercadoPagoAccount(input); return; }
    if (input.provider === "asaas") {
      const account = marketplaceCaptureAccount("asaas", input.environment, this.config.asaasKey, this.config.asaasOrigin);
      if (account.accountFingerprint !== input.accountFingerprint) throw new Error("marketplace_cancellation_account_mismatch");
      return;
    }
    const account = marketplaceCaptureAccount("stripe", input.environment, this.config.stripeSecret);
    if (account.accountFingerprint !== input.accountFingerprint) throw new Error("marketplace_cancellation_account_mismatch");
  }

  private matches(input: MarketplaceCancellationExecutionRequest, payment: Stripe.PaymentIntent): boolean {
    return payment.id === input.providerPaymentId && payment.object === "payment_intent" && payment.amount === input.amountCents &&
      payment.currency === "brl" && payment.livemode === (input.environment === "live") && !payment.transfer_data &&
      !payment.application_fee_amount && !payment.on_behalf_of && payment.metadata?.merchant_id === input.hostMerchantId &&
      payment.metadata?.intent_id === input.paymentIntentId && payment.metadata?.session_id === input.checkoutSessionId;
  }

  private async asaasRead(input: MarketplaceCancellationExecutionRequest, method: "GET" | "DELETE"): Promise<any> {
    const response = await this.request(`${new URL(this.config.asaasOrigin!).origin}/v3/payments/${input.providerPaymentId}`, {
      method, headers: { accept: "application/json", access_token: this.config.asaasKey!, "user-agent": "ZyonMarketplace/1.0" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("marketplace_cancellation_provider_unavailable");
    return response.json();
  }

  private async asaasPayment(input: MarketplaceCancellationExecutionRequest & { provider: "asaas" }): Promise<any | null> {
    const payment = await this.asaasRead(input, "GET");
    const cents = this.mercadoPagoCents(payment?.value);
    if (!payment || payment.object !== "payment" || payment.id !== input.providerPaymentId ||
        payment.customer !== input.asaasCustomerId || payment.billingType !== input.asaasBillingType ||
        payment.externalReference !== input.paymentIntentId || cents !== input.amountCents ||
        payment.installment || payment.subscription || payment.anticipated ||
        payment.split != null && (!Array.isArray(payment.split) || payment.split.length !== 0)) return null;
    return payment;
  }

  private asaasUncaptured(payment: any): boolean {
    return ["PENDING", "OVERDUE"].includes(payment.status) && !payment.chargeback &&
      (payment.refunds == null || Array.isArray(payment.refunds) && payment.refunds.length === 0) &&
      payment.paymentDate == null && payment.clientPaymentDate == null && payment.confirmedDate == null;
  }

  private mercadoPagoAccount(input: MarketplaceCancellationRequest) {
    const config = this.config.mercadoPago;
    let origin: URL;
    try { origin = new URL(config?.baseUrl ?? ""); } catch { throw new Error("marketplace_cancellation_account_mismatch"); }
    if (!config?.accessToken || origin.origin !== "https://api.mercadopago.com" || origin.pathname !== "/" ||
        origin.username || origin.password || origin.search || origin.hash || !["test", "live"].includes(input.environment) ||
        config.environment !== input.environment || createHash("sha256").update(`${config.baseUrl}\0${config.accessToken}`).digest("hex") !== input.accountFingerprint) {
      throw new Error("marketplace_cancellation_account_mismatch");
    }
    if (!input.hostMerchantId?.trim() || !input.paymentIntentId?.trim() || !input.checkoutSessionId?.trim() ||
        !/^[a-f0-9]{64}$/.test(input.instructionsHash) || !/^[1-9][0-9]*$/.test(input.providerPaymentId) || input.currency !== "BRL" ||
        !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 2_147_483_647) throw new Error("marketplace_cancellation_request_invalid");
  }

  private async mercadoPagoRead(path: string, init: RequestInit = {}): Promise<any> {
    const response = await this.request(`https://api.mercadopago.com${path}`, { ...init, method: init.method ?? "GET",
      headers: { accept: "application/json", Authorization: `Bearer ${this.config.mercadoPago!.accessToken}`, ...init.headers },
      redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("marketplace_cancellation_provider_unavailable");
    return response.json();
  }

  private mercadoPagoId(value: unknown): string | null {
    return typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value :
      typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }

  private mercadoPagoCents(value: unknown): number | null {
    if ((typeof value !== "number" && typeof value !== "string") || !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(String(value))) return null;
    const [whole, fraction = ""] = String(value).split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(amount) && amount <= 2_147_483_647 ? amount : null;
  }

  private async mercadoPagoPayment(input: MarketplaceCancellationRequest): Promise<any | null> {
    const owner = await this.mercadoPagoRead("/users/me");
    const ownerId = this.mercadoPagoId(owner?.id);
    if (!ownerId) return null;
    const payment = await this.mercadoPagoRead(`/v1/payments/${input.providerPaymentId}`);
    if (!payment || this.mercadoPagoId(payment.id) !== input.providerPaymentId || this.mercadoPagoId(payment.collector_id) !== ownerId ||
        payment.live_mode !== (input.environment === "live") || payment.currency_id !== "BRL" ||
        this.mercadoPagoCents(payment.transaction_amount) !== input.amountCents || payment.external_reference !== input.paymentIntentId ||
        payment.metadata?.merchant_id !== input.hostMerchantId || payment.metadata?.intent_id !== input.paymentIntentId ||
        payment.metadata?.session_id !== input.checkoutSessionId || payment.application_fee && payment.application_fee !== 0 ||
        payment.split || Array.isArray(payment.disbursements) && payment.disbursements.length) return null;
    return payment;
  }

  private mercadoPagoZero(payment: any): boolean {
    return payment.captured === false && payment.date_approved === null &&
      this.mercadoPagoCents(payment.transaction_details?.net_received_amount) === 0 &&
      this.mercadoPagoCents(payment.transaction_amount_refunded) === 0 && Array.isArray(payment.refunds) && payment.refunds.length === 0;
  }

  private mercadoPagoEvidence(input: MarketplaceCancellationRequest, payment: any): MarketplaceCancellationEvidence | null {
    const cancelled = typeof payment.date_last_updated === "string" ? Date.parse(payment.date_last_updated) : NaN;
    if (payment.status !== "cancelled" || !["by_collector", "by_payer", "expired"].includes(payment.status_detail) || !this.mercadoPagoZero(payment) ||
        !Number.isFinite(cancelled) || cancelled <= 0 || cancelled > Date.now() + 60_000) return null;
    return { ...input, provider: "mercadopago", checkoutSessionId: input.checkoutSessionId!, state: "terminal_uncaptured",
      amountReceivedCents: 0, amountCapturableCents: 0, cancelledAt: new Date(cancelled).toISOString(), observedAt: new Date().toISOString(),
      mercadoPago: { paymentId: input.providerPaymentId, collectorId: this.mercadoPagoId(payment.collector_id)!, status: "cancelled",
        statusDetail: payment.status_detail, captured: false, netReceivedAmountCents: 0, refundedAmountCents: 0, dateApproved: null } };
  }
}
