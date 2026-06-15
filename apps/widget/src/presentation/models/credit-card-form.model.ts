import type { StripeIntent } from "../../hooks/use-checkout-payment.js";

export type CreditCardFormModel = {
  busy: boolean;
  colorMode: "light" | "dark";
  totalLabel: string;
  stripeIntent: StripeIntent | null;
  onInitiate: () => void | Promise<void>;
  onStripePaymentConfirmed: (amountCents: number, currency: string) => void | Promise<void>;
  onStripePaymentError: (message: string) => void;
  onClose: () => void;
};
