import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { promisify } from "node:util";
import {
  generateKeyPair as generateKeyPairCb,
  randomUUID,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../../payment/domain/ports/payment-repository.port.js";
import type { PaymentIntentEntity } from "../../payment/domain/payment-intent.entity.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import type { CheckoutSession } from "@zyon/shared-types";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { MerchantProfile } from "../../merchant/domain/merchant.types.js";
import { AcpStoreDomainService } from "../agentic-protocol/acp-store-domain.service.js";
import {
  base64url,
  canonicalJsonStringify,
  computeSdHash,
  delegatePayloadEntry,
  sha256Hex,
} from "./acp-mandate-sd-hash.js";
import type {
  AcpCheckoutMandatePayload,
  AcpIssuerHeader,
  AcpIssuerPayload,
  AcpMandateAudience,
  AcpMandateResponse,
  AcpMandateVct,
  AcpPaymentInstrument,
  AcpPaymentMandatePayload,
} from "./acp-mandate.types.js";

const generateKeyPair = promisify(generateKeyPairCb) as (
  type: "ec",
  options: { namedCurve: "P-256" },
) => Promise<{ publicKey: KeyObject; privateKey: KeyObject }>;

/**
 * AP2 (Agent Payments Protocol) mandate issuer.
 *
 * Issues SD-JWT-style mandates for two flows:
 *  - **payment mandate** (`mandate.payment.1`) — bound to a payment intent;
 *    audience is `credential-provider` (the credential provider signs on behalf
 *    of the buyer to authorize the charge).
 *  - **checkout mandate** (`mandate.checkout.1`) — bound to a checkout
 *    session; audience is `merchant` (the merchant commits to fulfillment
 *    terms attached to the cart).
 *
 * Both are signed with an ECDSA P-256 keypair (ES256) generated in-process per
 * merchant. The keypair lives in an in-memory `Map<merchantId, KeyObject>` —
 * AP2 mandates are short-lived SD-JWTs (issued on demand by the public API),
 * so we don't persist private keys.
 *
 * Public endpoints (no auth) — path param alone is the capability.
 */
@Injectable()
export class AcpMandateIssuerService {
  private readonly logger = new Logger(AcpMandateIssuerService.name);
  private readonly signingKeys = new Map<string, KeyObject>();

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    private readonly storeDomain: AcpStoreDomainService,
  ) {}

  /**
   * Issue a payment_mandate for an existing payment intent. Resolves the
   * tenant via `getIntentByExternalReference` (intent id == externalReference
   * in the Asaas/Stripe adapters), then loads the full intent + merchant
   * profile to build the mandate payload.
   */
  async issuePaymentMandate(intentId: string): Promise<AcpMandateResponse> {
    const intentRef = await this.payments.getIntentByExternalReference(intentId);
    if (!intentRef) throw new NotFoundException("payment_intent_not_found");

    const intent = await this.payments.getIntentById(intentRef.merchantId, intentRef.id);
    if (!intent) throw new NotFoundException("payment_intent_not_found");

    const merchant = await this.merchants.getProfile(intentRef.merchantId);
    if (!merchant) throw new NotFoundException("payment_intent_not_found");

    return this.signAndWrap(intentRef.merchantId, "payment", () =>
      this.buildPaymentMandatePayload(intent, merchant),
    );
  }

  /**
   * Issue a checkout_mandate for an existing checkout session. The checkout
   * session repository is tenant-scoped (no global lookup by session id), so
   * the controller passes the merchant as a query param — combined with the
   * path session id, that's the capability for this public endpoint.
   */
  async issueCheckoutMandate(merchantId: string, sessionId: string): Promise<AcpMandateResponse> {
    const trimmedMerchant = merchantId.trim();
    const trimmedSession = sessionId.trim();
    const session = await this.sessions.getSession(trimmedMerchant, trimmedSession);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const merchant = await this.merchants.getProfile(trimmedMerchant);
    if (!merchant) throw new NotFoundException("checkout_session_not_found");

    return this.signAndWrap(trimmedMerchant, "checkout", () =>
      this.buildCheckoutMandatePayload(session, merchant),
    );
  }

  // -- payload builders ---------------------------------------------------

  private buildPaymentMandatePayload(
    intent: PaymentIntentEntity,
    merchant: MerchantProfile,
  ): AcpPaymentMandatePayload {
    const snap = intent.snapshot();
    return {
      transaction_id: snap.id,
      payee: {
        id: merchant.id,
        name: merchant.name ?? merchant.id,
        website: merchant.storeSettings?.seo?.canonicalUrl,
      },
      payment_amount: {
        amount: snap.amountCents,
        currency: snap.currency,
      },
      payment_instrument: this.buildPaymentInstrument(snap.id, snap.method),
    };
  }

  private buildCheckoutMandatePayload(
    session: CheckoutSession,
    merchant: MerchantProfile,
  ): AcpCheckoutMandatePayload {
    const totalMajor = Math.max(0, session.cart.total + (session.shipping?.customerPrice ?? 0));
    const totalCents = Math.round(totalMajor * 100);
    return {
      transaction_id: session.sessionId,
      merchant: {
        id: merchant.id,
        name: merchant.name ?? merchant.id,
        website: merchant.storeSettings?.seo?.canonicalUrl,
      },
      line_items: session.cart.items.map((item) => {
        const unitMajor = item.unit_price ?? item.price;
        return {
          sku: item.sku ?? item.product_id,
          name: item.name ?? item.title ?? item.sku ?? "Item",
          quantity: item.quantity,
          unit_price_cents: Math.round(unitMajor * 100),
        };
      }),
      total_amount: {
        amount: totalCents,
        currency: (session.cart.currency ?? "BRL").toUpperCase(),
      },
      confirmation_url: this.storeDomain.buildConfirmationUrl(
        { id: merchant.id, slug: merchant.slug },
        session.sessionId,
      ),
    };
  }

  private buildPaymentInstrument(intentId: string, method: string): AcpPaymentInstrument {
    const allowed: ReadonlyArray<AcpPaymentInstrument["type"]> = ["card", "pix", "boleto", "crypto"];
    const type: AcpPaymentInstrument["type"] = (allowed as ReadonlyArray<string>).includes(method)
      ? (method as AcpPaymentInstrument["type"])
      : "card";
    return {
      id: intentId,
      type,
      description: `${type.toUpperCase()} instrument for ${intentId}`,
    };
  }

  // -- signing -----------------------------------------------------------

  private async signAndWrap<TPayload extends object>(
    merchantId: string,
    kind: "payment" | "checkout",
    buildPayload: () => TPayload,
  ): Promise<AcpMandateResponse> {
    const payload = buildPayload();
    const vct: AcpMandateVct = kind === "payment" ? "mandate.payment.1" : "mandate.checkout.1";
    const aud: AcpMandateAudience = kind === "payment" ? "credential-provider" : "merchant";

    const disclosure = this.buildDisclosure(vct, payload);
    const digest = sha256Hex(disclosure.decoded);
    const sdHash = computeSdHash([digest]);

    const issuerPayload: AcpIssuerPayload = {
      delegate_payload: [delegatePayloadEntry(digest)],
      iat: Math.floor(Date.now() / 1000),
      aud,
      nonce: randomUUID(),
      sd_hash: sdHash,
      _sd_alg: "sha-256",
    };
    const issuerHeader: AcpIssuerHeader = { alg: "ES256", typ: "kb+sd-jwt" };

    // Sign to prove the issuer signed exactly this `sd_hash`. The compact JWS
    // (header.payload.signature) is the SD-JWT wire format — the response
    // exposes header/payload per the AP2 response shape and lets the holder
    // recompute the digests from the disclosed plaintext.
    await this.signCompact(merchantId, issuerHeader, issuerPayload);

    return {
      issuer_signed_jwt: {
        header: issuerHeader,
        payload: issuerPayload,
      },
      disclosures: [
        {
          digest,
          encoded: disclosure.encoded,
          decoded: disclosure.decoded,
        },
      ],
    };
  }

  /** Build a disclosure in SD-JWT wire format: [salt, vct, payload]. */
  private buildDisclosure<TPayload extends object>(
    vct: AcpMandateVct,
    payload: TPayload,
  ): { decoded: Array<string | Record<string, unknown> | number>; encoded: string } {
    const salt = randomUUID().replace(/-/g, "");
    const decoded: Array<string | Record<string, unknown> | number> = [
      salt,
      vct,
      payload as unknown as Record<string, unknown>,
    ];
    const encoded = base64url(canonicalJsonStringify(decoded));
    return { decoded, encoded };
  }

  private async signCompact(
    merchantId: string,
    header: AcpIssuerHeader,
    payload: AcpIssuerPayload,
  ): Promise<string> {
    const key = await this.ensureSigningKey(merchantId);
    const headerB64 = base64url(canonicalJsonStringify(header));
    const payloadB64 = base64url(canonicalJsonStringify(payload));
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
    // ES256 (sha-256 over ECDSA P-256) with raw (ieee-p1363) signature output —
    // 64 bytes for P-256. JWS compact form expects the raw signature, not the
    // DER envelope.
    const signature = cryptoSign("sha256", signingInput, {
      key,
      dsaEncoding: "ieee-p1363",
    });
    return `${headerB64}.${payloadB64}.${base64url(signature)}`;
  }

  /**
   * Pre-warm the per-merchant signing key. Safe to call multiple times — the
   * second call is a cache hit.
   */
  async ensureSigningKey(merchantId: string): Promise<KeyObject> {
    const cached = this.signingKeys.get(merchantId);
    if (cached) return cached;
    const { privateKey } = await generateKeyPair("ec", { namedCurve: "P-256" });
    this.signingKeys.set(merchantId, privateKey);
    this.logger.log({ event: "acp_mandate.signing_key.created", merchantId });
    return privateKey;
  }
}
