import { BadRequestException } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { fiscalRecipientFromCustomer } from "../domain/fiscal-checkout.port.js";
import { FISCAL_RECIPIENT_FIELDS, validateFiscalRecipient, type FiscalRecipient, type FiscalRecipientField } from "../domain/fiscal-recipient.js";
import type { FiscalRecipientStore, FiscalPersonalPatch } from "../domain/fiscal-recipient-update.port.js";
import type { FiscalPostalLookupPort } from "../domain/fiscal-postal-lookup.port.js";
export const FISCAL_RECIPIENT_PREPARATION = Symbol("FISCAL_RECIPIENT_PREPARATION");

function validParts(input: FiscalRecipient): FiscalRecipient {
  const result: FiscalRecipient = {};
  for (const field of FISCAL_RECIPIENT_FIELDS) {
    const value = field.startsWith("address.") ? input.address?.[field.slice(8) as keyof NonNullable<FiscalRecipient["address"]>] : input[field as "name" | "taxId" | "email" | "phone"];
    const piece = field.startsWith("address.") ? { address: { [field.slice(8)]: value } } : { [field]: value };
    const validation = validateFiscalRecipient(piece, [field]);
    if (validation.valid) {
      if (validation.recipient.address) result.address = { ...result.address, ...validation.recipient.address };
      else Object.assign(result, validation.recipient);
    }
  }
  return result;
}
export function fiscalRecipientMode(session: CheckoutSession): "buyer" | "other" {
  return session.customer?.fiscalRecipientMode ?? (Object.keys(session.customer?.fiscalRecipient ?? {}).length ? "other" : "buyer");
}
export function personalPatchForFiscalRecipient(session: CheckoutSession, recipient: FiscalRecipient, mode = fiscalRecipientMode(session)): FiscalPersonalPatch {
  if (mode !== "buyer") return {};
  const current = validParts({ name: session.customer?.fullName, taxId: session.customer?.cpf, email: session.customer?.email, phone: session.customer?.phone });
  return { ...(!current.name && recipient.name ? { fullName: recipient.name } : {}),
    ...(!current.taxId && recipient.taxId?.length === 11 ? { cpf: recipient.taxId } : {}) };
}

/** Uses the already authenticated/collected session. It never queries a global account by public hints. */
export class FiscalRecipientPreparationService {
  constructor(private readonly store: FiscalRecipientStore, private readonly postal: FiscalPostalLookupPort) {}
  async resolve(session: CheckoutSession, input: { mode?: "buyer" | "other"; patch?: FiscalRecipient } = {}) {
    const mode = input.mode ?? fiscalRecipientMode(session);
    const personalSession = { ...session, customer: { ...session.customer, fiscalRecipientMode: "buyer" as const,
      ...(input.mode === "buyer" && fiscalRecipientMode(session) !== "buyer" ? { fiscalRecipient: {} } : {}) } };
    let recipient = mode === "buyer" ? validParts(fiscalRecipientFromCustomer(personalSession.customer))
      : input.mode === "other" && fiscalRecipientMode(session) !== "other" ? {} : structuredClone(session.customer?.fiscalRecipient ?? {});
    if (input.patch) {
      if (mode === "buyer" && recipient.taxId && input.patch.taxId && recipient.taxId !== input.patch.taxId) throw new BadRequestException("fiscal_other_recipient_selection_required");
      recipient = { ...recipient, ...input.patch, address: { ...recipient.address, ...input.patch.address } };
    }
    if (mode === "buyer" && recipient.taxId && recipient.taxId.length !== 11) throw new BadRequestException("fiscal_other_recipient_selection_required");
    const cached = session.customer?.fiscalRecipient;
    const a = recipient.address;
    const fold = (value?: string) => value?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
    const sameAddress = a?.postalCode && cached?.address?.postalCode === a.postalCode
      && fold(cached.address.city) === fold(a.city) && cached.address.state === a.state;
    if (sameAddress && /^\d{7}$/.test(cached?.address?.cityCode ?? "") && cached?.address?.countryCode === "1058") {
      // Technical identifiers are server-owned, including when a public patch supplies different values.
      a!.cityCode = cached.address!.cityCode; a!.countryCode = cached.address!.countryCode;
    } else if (a?.postalCode) {
      const resolved = await this.postal.lookup(a.postalCode);
      delete a.cityCode; delete a.countryCode;
      if (resolved && (!a.city || fold(a.city) === fold(resolved.city)) && (!a.state || a.state === resolved.state)) {
        recipient.address = { ...resolved, ...a, cityCode: resolved.cityCode, countryCode: resolved.countryCode };
      }
    } else if (a) { delete a.cityCode; delete a.countryCode; }
    return { mode, recipient };
  }
  async persist(session: CheckoutSession, prepared: { mode: "buyer" | "other"; recipient: FiscalRecipient }) {
    const personal = personalPatchForFiscalRecipient(session, prepared.recipient, prepared.mode);
    await this.store.saveRecipient({ merchantId: session.merchantId, sessionId: session.sessionId, buyerId: session.globalUserId,
      recipient: prepared.recipient, mode: prepared.mode, personal, expectedCustomer: session.customer ?? {} });
    session.customer = { ...session.customer, ...personal, fiscalRecipient: prepared.recipient, fiscalRecipientMode: prepared.mode };
    return personal;
  }
  publicCorrectionFields(fields: readonly FiscalRecipientField[], mode: "buyer" | "other") {
    return [...new Set(fields.map(field => mode === "buyer" && ["address.cityCode", "address.countryCode"].includes(field) ? "address.postalCode" as const : field))];
  }
}
