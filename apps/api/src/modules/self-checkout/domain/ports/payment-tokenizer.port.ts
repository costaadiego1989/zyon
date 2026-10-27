/**
 * P2 PCI fix: PAN/CVV must never cross the application/domain boundary.
 * Tokenization happens at the presentation (controller/gateway) layer.
 * Use-cases receive only the TokenizeCardResult (opaque token + metadata).
 *
 * TokenizeCardInput is intentionally kept here as a presentation-layer type so
 * the controller can call the tokenizer at the edge before invoking the use-case.
 */
export const PAYMENT_TOKENIZER = Symbol("PAYMENT_TOKENIZER");

/** Raw card data — only used at the presentation/gateway layer. Never passed to application/domain. */
export interface TokenizeCardInput {
  card_number: string;
  expiry_month: string;
  expiry_year: string;
  cvv: string;
  holder_name: string;
}

/** Opaque tokenisation result — safe to pass across all layers. */
export interface TokenizeCardResult {
  gateway: "asaas";
  gateway_token: string;
  last_four: string;
  brand: string;
  expires_at: Date;
}

export interface PaymentTokenizerPort {
  tokenize(input: TokenizeCardInput): Promise<TokenizeCardResult>;
}
