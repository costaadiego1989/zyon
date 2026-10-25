import { Injectable } from "@nestjs/common";
import type { PaymentTokenizerPort, TokenizeCardInput, TokenizeCardResult } from "../../domain/ports/payment-tokenizer.port.js";

@Injectable()
export class StubPaymentTokenizerAdapter implements PaymentTokenizerPort {
  async tokenize(input: TokenizeCardInput): Promise<TokenizeCardResult> {
    const last_four = input.card_number.slice(-4);
    const brand = input.card_number.startsWith("4") ? "visa" : "mastercard";

    // P3 fix: use Date.UTC with explicit parsing to avoid invalid dates from non-zero-padded
    // month strings (e.g. "3" instead of "03") and 2-digit vs 4-digit year variants.
    const rawMonth = input.expiry_month.trim();
    const rawYear = input.expiry_year.trim();

    const monthInt = parseInt(rawMonth, 10);
    // Support both 2-digit (YY) and 4-digit (YYYY) year inputs.
    const yearInt = rawYear.length <= 2 ? 2000 + parseInt(rawYear, 10) : parseInt(rawYear, 10);

    if (
      isNaN(monthInt) || isNaN(yearInt) ||
      monthInt < 1 || monthInt > 12 ||
      yearInt < 2000 || yearInt > 2099
    ) {
      throw new Error("invalid_card_expiry");
    }

    // monthIndex is 0-based; day 1 → first of the expiry month at UTC midnight.
    const expires_at = new Date(Date.UTC(yearInt, monthInt - 1, 1));

    return {
      gateway: "asaas",
      gateway_token: `tok_stub_${crypto.randomUUID()}`,
      last_four,
      brand,
      expires_at,
    };
  }
}
