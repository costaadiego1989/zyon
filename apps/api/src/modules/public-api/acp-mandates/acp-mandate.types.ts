/**
 * AP2 mandate types.
 *
 * The AP2 (Agent Payment Protocol) payment + checkout mandates are SD-JWTs
 * (IETF draft-ietf-oauth-selective-disclosure-jwt) where every sensitive claim
 * lives in a separate disclosure. The issuer-signed JWT contains only the
 * digest list (`delegate_payload`), an issued-at, audience, nonce, and the
 * binding `sd_hash`. Holders reveal the payload by appending its disclosure
 * (the salt + value array) to the JWS compact serialization.
 *
 * Reference: AP2 spec (Agent Payments Protocol) — payment_mandate vct
 * `mandate.payment.1` and cart/checkout mandate vct `mandate.checkout.1`.
 */

/** AP2 verification context type (`vct`) — discriminates the mandate kind. */
export type AcpMandateVct = "mandate.payment.1" | "mandate.checkout.1";

/** Audience bound to the JWT — credential-provider for payment, merchant for cart. */
export type AcpMandateAudience = "credential-provider" | "merchant";

export type AcpPaymentInstrumentType = "card" | "pix" | "boleto" | "crypto";

export interface AcpPayee {
  id: string;
  name: string;
  website?: string;
}

export interface AcpPaymentAmount {
  amount: number;
  currency: string;
}

export interface AcpPaymentInstrument {
  id: string;
  type: AcpPaymentInstrumentType;
  description?: string;
}

export interface AcpPaymentMandatePayload {
  transaction_id: string;
  payee: AcpPayee;
  payment_amount: AcpPaymentAmount;
  payment_instrument: AcpPaymentInstrument;
}

export interface AcpLineItemDescriptor {
  sku?: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
}

export interface AcpCheckoutMandatePayload {
  transaction_id: string;
  merchant: AcpPayee;
  line_items: AcpLineItemDescriptor[];
  total_amount: AcpPaymentAmount;
  confirmation_url?: string;
}

/** Issuer-signed JWT header — fixed shape per AP2 mandate requirement. */
export interface AcpIssuerHeader {
  alg: "ES256";
  typ: "kb+sd-jwt";
}

/** Issuer-signed JWT payload — only digest references, not the values. */
export interface AcpIssuerPayload {
  /** Each entry is `{"...": "<sha256-hex>"}` — one per disclosure. */
  delegate_payload: Array<Record<string, string>>;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Bound audience — credential-provider for payment, merchant for checkout. */
  aud: AcpMandateAudience;
  /** Per-issuance random nonce (UUID v4). */
  nonce: string;
  /** SHA-256 of the concatenated disclosure digests. */
  sd_hash: string;
  /** Hash algorithm used for `sd_hash` and `delegate_payload`. */
  _sd_alg: "sha-256";
}

/** Compact JWS: header + payload + signature, all base64url, joined by `.`. */
export interface AcpIssuerSignedJwt {
  header: AcpIssuerHeader;
  payload: AcpIssuerPayload;
  /** Compact serialization of the JWS — `${b64u(header)}.${b64u(payload)}.${b64u(sig)}`. */
  compact: string;
}

export interface AcpMandateDisclosure {
  /** sha256-hex over the canonical encoding of the decoded array. */
  digest: string;
  /** Base64url-encoded disclosure (the format appended after the JWS). */
  encoded: string;
  /** Salt + vct + payload — the original array the digest is computed over. */
  decoded: Array<string | Record<string, unknown> | number>;
}

/** AP2 mandate response — matches the spec shape exactly. */
export interface AcpMandateResponse {
  issuer_signed_jwt: {
    header: AcpIssuerHeader;
    payload: AcpIssuerPayload;
  };
  disclosures: AcpMandateDisclosure[];
}
