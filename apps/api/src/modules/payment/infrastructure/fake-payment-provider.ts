import { Injectable } from "@nestjs/common";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

@Injectable()
export class FakePaymentProvider implements PaymentProviderPort {
  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
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
}
