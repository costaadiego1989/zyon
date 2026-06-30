import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { TrustedCartSnapshot } from "@zyon/commerce-adapters";
import { COMMERCE_CART_PORT, type CommerceCartPort } from "../domain/ports/commerce-cart.port.js";

export type ValidateCartForPaymentInput = {
  merchantId: string;
  commerceCartRef: string;
  /** Se omitido, confia apenas no snapshot devolvido pela commerce. */
  clientReportedTotalCents?: number;
};

export type ValidateCartForPaymentOutput = {
  trustedCart: TrustedCartSnapshot;
};

@Injectable()
export class ValidateCartForPaymentUseCase {
  constructor(
    @Inject(COMMERCE_CART_PORT)
    private readonly cart: CommerceCartPort
  ) {}

  async execute(input: ValidateCartForPaymentInput): Promise<ValidateCartForPaymentOutput> {
    const merchantId = input.merchantId.trim();
    const commerceCartRef = input.commerceCartRef.trim();

    const trusted = await this.cart.validateCart({
      merchantId,
      commerceCartRef
    });

    if (trusted.commerceCartRef.trim() !== commerceCartRef) {
      throw new BadRequestException("commerce_cart_ref_mismatch");
    }

    if (
      input.clientReportedTotalCents !== undefined &&
      input.clientReportedTotalCents !== trusted.totalCents
    ) {
      throw new BadRequestException("client_total_mismatch");
    }

    return { trustedCart: trusted };
  }
}
