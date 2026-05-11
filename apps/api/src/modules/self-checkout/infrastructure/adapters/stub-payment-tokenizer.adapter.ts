import { Injectable } from "@nestjs/common";
import type { PaymentTokenizerPort, TokenizeCardInput, TokenizeCardResult } from "../../domain/ports/payment-tokenizer.port.js";

@Injectable()
export class StubPaymentTokenizerAdapter implements PaymentTokenizerPort {
  async tokenize(input: TokenizeCardInput): Promise<TokenizeCardResult> {
    const last_four = input.card_number.slice(-4);
    const brand = input.card_number.startsWith("4") ? "visa" : "mastercard";
    const [month, year] = [input.expiry_month, input.expiry_year];
    const expires_at = new Date(`20${year}-${month}-01`);

    return {
      gateway: "asaas",
      gateway_token: `tok_stub_${crypto.randomUUID()}`,
      last_four,
      brand,
      expires_at,
    };
  }
}
