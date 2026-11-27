import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { FISCAL_RECIPIENT_STORE, type FiscalRecipientStore } from "../domain/fiscal-recipient-update.port.js";
import { FISCAL_RECIPIENT_FIELDS, validateFiscalRecipient } from "../domain/fiscal-recipient.js";
import { FISCAL_BEFORE_PAYMENT, type FiscalBeforePaymentPort } from "../domain/fiscal-checkout.port.js";
import { FISCAL_POSTAL_LOOKUP, type FiscalPostalLookupPort } from "../domain/fiscal-postal-lookup.port.js";
import { FISCAL_RECIPIENT_PREPARATION, FiscalRecipientPreparationService } from "./fiscal-recipient-preparation.service.js";

@Injectable()
export class FiscalRecipientUpdateService {
  constructor(@Inject(FISCAL_RECIPIENT_STORE) private readonly store: FiscalRecipientStore,
    @Inject(FISCAL_BEFORE_PAYMENT) private readonly gate: FiscalBeforePaymentPort,
    @Optional() @Inject(FISCAL_POSTAL_LOOKUP) private readonly postalLookup?: FiscalPostalLookupPort,
    @Optional() @Inject(FISCAL_RECIPIENT_PREPARATION) private readonly preparation?: FiscalRecipientPreparationService) {}
  async prepare(input: { merchantId: string; sessionId: string; mode?: "buyer" | "other"; buyerId?: string }) {
    const session = await this.store.getSession(input.merchantId, input.sessionId);
    if (!session || input.buyerId !== undefined && session.globalUserId !== input.buyerId) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    if (!this.preparation || !this.gate.requirements) throw new ServiceUnavailableException("fiscal_recipient_preparation_unavailable");
    const required = await this.gate.requirements(session);
    if (!required.length) return { active: false, mode: "buyer" as const, fields: [], recipient: {} };
    const prepared = await this.preparation.resolve(session, { mode: input.mode });
    const validation = validateFiscalRecipient(prepared.recipient, required);
    await this.preparation.persist(session, prepared);
    return { active: true, ...prepared, fields: validation.valid ? [] : this.preparation.publicCorrectionFields(validation.fields, prepared.mode) };
  }
  async lookupAddress(input: { merchantId: string; sessionId: string; postalCode: unknown }) {
    if (!await this.store.getSession(input.merchantId, input.sessionId)) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    if (typeof input.postalCode !== "string" || !/^\d{5}-?\d{3}$/.test(input.postalCode)) throw new BadRequestException("fiscal_postal_code_invalid");
    const address = await this.postalLookup?.lookup(input.postalCode.replace("-", ""));
    if (!address || !/^\d{7}$/.test(address.cityCode ?? "")) throw new ServiceUnavailableException("fiscal_address_lookup_unavailable");
    return { address };
  }
  async update(input: { merchantId: string; sessionId: string; recipient: unknown; buyerId?: string }) {
    const session = await this.store.getSession(input.merchantId, input.sessionId);
    if (!session || input.buyerId !== undefined && session.globalUserId !== input.buyerId) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    const value = input.recipient;
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !["name", "taxId", "email", "phone", "address"].includes(key))) throw new BadRequestException("fiscal_recipient_invalid");
    const address = (value as { address?: unknown }).address;
    if (address !== undefined && (!address || typeof address !== "object" || Array.isArray(address)
      || Object.keys(address).some(key => !FISCAL_RECIPIENT_FIELDS.includes(("address." + key) as typeof FISCAL_RECIPIENT_FIELDS[number])))) throw new BadRequestException("fiscal_recipient_invalid");
    const validation = validateFiscalRecipient(value, []);
    if (!validation.valid) throw new BadRequestException(validation);
    const prepared = this.preparation ? await this.preparation.resolve(session, { patch: validation.recipient }) : undefined;
    const recipient = prepared?.recipient ?? validation.recipient;
    const candidate = { ...session, customer: { ...session.customer, fiscalRecipient: recipient,
      ...(prepared ? { fiscalRecipientMode: prepared.mode } : {}) } };
    await this.gate.assertBeforePayment(candidate, { persist: false });
    const personal = prepared ? await this.preparation!.persist(session, prepared) : undefined;
    if (!prepared) await this.store.saveRecipient({ merchantId: input.merchantId, sessionId: input.sessionId,
      buyerId: session.globalUserId, recipient, expectedCustomer: session.customer ?? {} });
    return { ok: true, recipient, ...(personal && Object.keys(personal).length ? { personal } : {}) };
  }
}
