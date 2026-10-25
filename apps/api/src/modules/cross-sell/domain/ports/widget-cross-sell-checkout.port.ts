import type { z } from "zod";
import type { Cart, ShippingQuote } from "@zyon/shared-types";
import type { widgetCrossSellCheckoutQuoteSchema } from "../contracts/widget-cross-sell-checkout-quote.schemas.js";
import type { WidgetCrossSellCheckoutScope, WidgetCrossSellCheckoutQuoteRequest,
  WidgetCrossSellCheckoutAcceptance, WidgetCrossSellCheckoutAcknowledgement,
  WidgetCrossSellCheckoutCustomerCommand, WidgetCrossSellCheckoutCustomerAcknowledgement,
  WidgetCrossSellCheckoutAddressCommand, WidgetCrossSellCheckoutEmailOtpCommand,
  WidgetCrossSellCheckoutManualShippingCommand, WidgetCrossSellCheckoutManualShippingSelection } from "../contracts/widget-cross-sell-checkout-command.schemas.js";

/** Embed-authenticated scope must be supplied separately from the request. */
export interface WidgetCrossSellCheckoutPort {
  quote(scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutQuoteRequest): Promise<z.infer<typeof widgetCrossSellCheckoutQuoteSchema>>;
  accept(scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutAcceptance): Promise<WidgetCrossSellCheckoutAcknowledgement>;
  readAccepted(scope: WidgetCrossSellCheckoutScope): Promise<Cart>;
  updateCustomer(scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutCustomerCommand): Promise<WidgetCrossSellCheckoutCustomerAcknowledgement>;
  updateAddress(scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutAddressCommand): Promise<WidgetCrossSellCheckoutCustomerAcknowledgement>;
  verifyEmailOtp(scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutEmailOtpCommand): Promise<WidgetCrossSellCheckoutCustomerAcknowledgement>;
  quoteManualShipping(scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutManualShippingCommand): Promise<WidgetCrossSellCheckoutCustomerAcknowledgement>;
  selectManualShipping(scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutManualShippingSelection): Promise<WidgetCrossSellCheckoutCustomerAcknowledgement>;
  readAcceptedShipping(scope: WidgetCrossSellCheckoutScope): Promise<ShippingQuote | null>;
}
