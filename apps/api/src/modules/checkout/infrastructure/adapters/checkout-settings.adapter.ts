import { Injectable } from "@nestjs/common";
import type { CheckoutSettingsContext } from "@zyon/shared-types";
import { GetCheckoutSettingsContextUseCase } from "../../../checkout-settings/application/checkout-settings.use-cases.js";
import type { CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";

@Injectable()
export class CheckoutSettingsAdapter implements CheckoutSettingsPort {
  constructor(private readonly getCheckoutSettingsContext: GetCheckoutSettingsContextUseCase) {}

  getContext(merchantId: string): Promise<CheckoutSettingsContext | undefined> {
    return this.getCheckoutSettingsContext.execute(merchantId);
  }
}
