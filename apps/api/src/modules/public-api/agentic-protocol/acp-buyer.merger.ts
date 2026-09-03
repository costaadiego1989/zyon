import { Inject, Injectable } from "@nestjs/common";
import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository,
} from "../../checkout/domain/ports/checkout-session.repository.port.js";

export interface AcpBuyerInput {
  email?: string;
  full_name?: string;
  phone?: string;
  cpf?: string;
}

export interface AcpAddressInput {
  name?: string;
  line_one?: string;
  line_two?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
}

/**
 * Merges buyer/address updates onto a session's existing customer hints and
 * persists the result. Field-by-field merge so partial PATCH semantics are
 * preserved.
 */
@Injectable()
export class AcpBuyerMerger {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY)
    private readonly sessions: CheckoutSessionRepository,
  ) {}

  async mergeAndApply(
    session: CheckoutSession,
    buyer?: AcpBuyerInput,
    address?: AcpAddressInput,
  ): Promise<void> {
    const existing = session.customer ?? {};
    const next: CustomerHints = {
      ...existing,
      email: buyer?.email ?? existing.email,
      fullName: buyer?.full_name ?? existing.fullName,
      phone: buyer?.phone ?? existing.phone,
      cpf: buyer?.cpf ?? existing.cpf,
    };

    if (address) {
      next.address = {
        ...(existing.address ?? {}),
        zip: address.postal_code ?? existing.address?.zip,
        street: address.line_one ?? existing.address?.street,
        number: existing.address?.number,
        complement: address.line_two ?? existing.address?.complement,
        city: address.city ?? existing.address?.city,
        state: address.state ?? existing.address?.state,
      };
    }

    await this.sessions.saveSession({
      ...session,
      customer: next,
      updatedAt: new Date().toISOString(),
    });
  }
}
