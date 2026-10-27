import { BadRequestException } from "@nestjs/common";

export type PaymentConnectReturn = "onboarding" | "payment-connections";

export function paymentConnectReturn(value?: unknown): PaymentConnectReturn {
  if (value === undefined || value === "payment-connections") return "payment-connections";
  if (value === "onboarding") return value;
  throw new BadRequestException("payment_connect_return_invalid");
}
