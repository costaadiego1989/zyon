import { Injectable } from "@nestjs/common";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

@Injectable()
export class FakePaymentProvider implements PaymentProviderPort {
  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (input.method === "crypto") {
      return {
        providerPaymentId: `fake_crypto_${input.intentId}`,
        status: "requires_action",
        buyerFacingPayload: {
          chainId: 80002,
          chain: "polygon",
          evmNetwork: "testnet",
          chainLabel: "Polygon",
          tokenAddress: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
          tokenSymbol: "USDC",
          amountAtomic: "1000000",
          amountDisplay: "1.00 USDC",
          destinationAddress: "0x0000000000000000000000000000000000000001",
          quoteExpiresAt: new Date(Date.now() + 900_000).toISOString()
        }
      };
    }
    void input;
    return {
      providerPaymentId: "fake_pay_1",
      status: "requires_action",
      buyerFacingPayload: {
        qrCodeCopyPaste: "fake_br_code",
        invoiceUrl: "https://example.test/invoice/fake_pay_1"
      }
    };
  }

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    void input;
    return { state: "pending" };
  }
}
