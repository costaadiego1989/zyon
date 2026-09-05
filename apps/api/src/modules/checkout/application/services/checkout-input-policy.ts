import { BadRequestException } from "@nestjs/common";
import type { CustomerHints } from "@zyon/shared-types";

/** Browser hints can collect data; they cannot assert identity or provider ownership. */
export function unverifiedCustomerHints(input: CustomerHints | undefined): CustomerHints | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("checkout_customer_invalid");
  }
  const result: CustomerHints = {};
  for (const key of ["email", "phone", "fullName", "cpf"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "string" || input[key]!.length > 320) {
      throw new BadRequestException("checkout_customer_invalid");
    }
    result[key] = input[key]!.trim();
  }
  if (result.email) result.email = result.email.toLowerCase();
  if (input.address !== undefined) {
    if (!input.address || typeof input.address !== "object" || Array.isArray(input.address)) {
      throw new BadRequestException("checkout_address_invalid");
    }
    result.address = {};
    for (const key of ["zip", "street", "number", "complement", "neighborhood", "city", "state"] as const) {
      const value = input.address[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || value.length > 320) {
        throw new BadRequestException("checkout_address_invalid");
      }
      result.address[key] = value.trim();
    }
  }
  return result;
}
