import { Injectable } from "@nestjs/common";
import type { CheckoutSettingsContext } from "@zyon/shared-types";
import { GetCheckoutSettingsContextUseCase } from "../../checkout-settings/application/checkout-settings.use-cases.js";
import type { CheckoutSettingsContextPort } from "../domain/ports/checkout-settings-context.port.js";

@Injectable()
export class CheckoutSettingsContextAdapter implements CheckoutSettingsContextPort {
  constructor(private readonly getCheckoutSettingsContext: GetCheckoutSettingsContextUseCase) {}

  getContext(merchantId: string): Promise<CheckoutSettingsContext | undefined> {
    return this.getCheckoutSettingsContext.execute(merchantId);
  }
}
