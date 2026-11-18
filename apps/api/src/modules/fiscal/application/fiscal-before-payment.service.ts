import { BadRequestException } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import type { FiscalBeforePaymentPort, FiscalCheckoutReaderPort } from "../domain/fiscal-checkout.port.js";
import { fiscalRecipientFromCustomer } from "../domain/fiscal-checkout.port.js";
import { FISCAL_BASE_RECIPIENT_REQUIREMENTS, FISCAL_RECIPIENT_FIELDS, validateFiscalRecipient, type FiscalRecipientField } from "../domain/fiscal-recipient.js";
import type { FiscalProfileService } from "./fiscal-profile.service.js";
import type { FiscalRecipientPreparationService } from "./fiscal-recipient-preparation.service.js";

export class FiscalBeforePaymentService implements FiscalBeforePaymentPort {
  constructor(private readonly reader: FiscalCheckoutReaderPort, private readonly profiles: FiscalProfileService,
    private readonly preparation?: FiscalRecipientPreparationService) {}
  async requirements(session: CheckoutSession): Promise<FiscalRecipientField[]> {
    const contexts = await this.reader.load(session);
    const fields = new Set<FiscalRecipientField>();
    for (const context of contexts) {
      const candidates = context.lines.filter(line => !["digital", "service"].includes(line.productType));
      if (!candidates.length) continue;
      const profile = this.profiles.readiness(context.profile);
      const known = Array.isArray(context.profile?.recipientRequirements)
        ? context.profile.recipientRequirements.filter((field): field is FiscalRecipientField => FISCAL_RECIPIENT_FIELDS.includes(field as FiscalRecipientField)) : [];
      // FI-D09: tax setup failures leave a paid fiscal pending operation. They do
      // not waive the buyer data required before payment (FI-D05).
      const requirements = profile.ready ? profile.requirements : [...new Set([...FISCAL_BASE_RECIPIENT_REQUIREMENTS, ...known])];
      requirements.forEach(field => fields.add(field));
    }
    return [...fields];
  }
  async resolveRecipient(session: CheckoutSession) {
    return this.preparation ? (await this.preparation.resolve(session)).recipient : fiscalRecipientFromCustomer(session.customer);
  }
  async assertBeforePayment(session: CheckoutSession, options?: { persist?: boolean }): Promise<void> {
    const fields = await this.requirements(session); if (!fields.length) return;
    const prepared = this.preparation ? await this.preparation.resolve(session) : { mode: session.customer?.fiscalRecipientMode ?? "other" as const, recipient: fiscalRecipientFromCustomer(session.customer) };
    const validation = validateFiscalRecipient(prepared.recipient, fields);
    if (!validation.valid) throw new BadRequestException({ code: "fiscal_customer_data_required", message: "fiscal_customer_data_required",
      fields: this.preparation?.publicCorrectionFields(validation.fields, prepared.mode) ?? validation.fields });
    if (this.preparation && options?.persist !== false) await this.preparation.persist(session, { ...prepared, recipient: validation.recipient });
  }
}
