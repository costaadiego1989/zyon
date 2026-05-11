export const PAYMENT_TOKENIZER = Symbol("PAYMENT_TOKENIZER");

export interface TokenizeCardInput {
  card_number: string;
  expiry_month: string;
  expiry_year: string;
  cvv: string;
  holder_name: string;
}

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
