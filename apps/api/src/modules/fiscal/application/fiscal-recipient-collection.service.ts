import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ChatMessageResponse } from "@zyon/shared-types";
import type { FiscalBeforePaymentPort } from "../domain/fiscal-checkout.port.js";
import type { FiscalPostalLookupPort } from "../domain/fiscal-postal-lookup.port.js";
import type { FiscalRecipientCollectionInput, FiscalRecipientCollectionPort, FiscalRecipientCollectionState, FiscalRecipientCollectionStore } from "../domain/fiscal-recipient-collection.port.js";
import { validateFiscalRecipient, type FiscalRecipient, type FiscalRecipientField } from "../domain/fiscal-recipient.js";
import { fiscalRecipientFromCustomer } from "../domain/fiscal-checkout.port.js";
import { fiscalRecipientMode, personalPatchForFiscalRecipient } from "./fiscal-recipient-preparation.service.js";
import { isBrazilianMobilePhone } from "../../checkout/domain/services/customer-extraction.service.js";
import { requiresPhysicalDelivery } from "../../checkout/domain/services/cart-fulfillment.js";

const prompts: Partial<Record<FiscalRecipientField, string>> = {
  name: "Para a nota fiscal, informe o nome ou razão social do destinatário.", taxId: "Informe o CPF ou CNPJ do destinatário da nota.",
  "address.postalCode": "Informe o CEP do endereço da nota.", "address.street": "Informe a rua do endereço da nota.",
  "address.number": "Informe o número do endereço da nota (ou S/N).", "address.neighborhood": "Informe o bairro do endereço da nota.",
  email: "Informe o e-mail do destinatário da nota.", phone: "Informe o telefone do destinatário da nota.",
};
const paymentCommand = /\b(pix|pagar|pagamento|cart[aã]o|nota fiscal|dados fiscais)\b/i;
function response(message: string, labels: string[] = []): ChatMessageResponse {
  return { message, objection: "unknown", actions: labels.map(label => ({ label, type: "continue_checkout" })), turns: [], stage: "data_collection" };
}
function addressLabel(recipient: FiscalRecipient) {
  const a = recipient.address; return [a?.street, a?.number, a?.complement, a?.neighborhood, a?.city, a?.state, a?.postalCode].filter(Boolean).join(", ");
}

/** This path consumes buyer text directly. It never calls an LLM, payment or issuer. */
export class FiscalRecipientCollectionService implements FiscalRecipientCollectionPort {
  constructor(private readonly store: FiscalRecipientCollectionStore, private readonly gate: FiscalBeforePaymentPort,
    private readonly postal: FiscalPostalLookupPort) {}
  async handle(input: FiscalRecipientCollectionInput): Promise<ChatMessageResponse | undefined> {
    const record = await this.store.read(input.merchantId, input.sessionId);
    if (!record) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    const command = input.userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const selection = /^(usar|quero|nota).*(outro destinatario|outra pessoa|empresa|cnpj)/.test(command) ? "other" as const
      : /^(usar|quero).*(meus dados|meu cpf)/.test(command) ? "buyer" as const : undefined;
    if (!record.state && !paymentCommand.test(input.userMessage) && !selection) return undefined;
    if (input.buyerId !== undefined ? input.buyerId !== record.session.globalUserId : input.sessionBound !== true) throw new UnauthorizedException("fiscal_checkout_ownership_required");
    // Ordinary buyer identity/address belongs to the existing checkout conversation.
    if (!selection && fiscalRecipientMode(record.session) === "buyer") return undefined;
    if (typeof input.userMessage !== "string" || input.userMessage.length > 1024 || input.messageId && input.messageId.length > 256) throw new BadRequestException("fiscal_collection_input_invalid");
    const textHash = createHash("sha256").update(input.userMessage.trim()).digest("hex");
    const key = createHash("sha256").update(input.messageId ? "id:" + input.messageId : "text:" + textHash + ":" + record.version).digest("hex");
    let state = record.state;
    const previous = input.messageId ? state?.seen[key] : state?.lastFallback?.textHash === textHash ? state.seen[state.lastFallback.key] : undefined;
    if (previous) return response(previous.message, previous.labels);
    if (state?.finished && !selection) return undefined;
    if (selection) { state = null; record.session.customer = { ...record.session.customer, fiscalRecipientMode: selection, fiscalRecipient: {} }; }
    if (!selection && fiscalRecipientMode(record.session) === "buyer") {
      const c = record.session.customer; const a = c?.address;
      // Registration and delivery remain owned by the normal checkout. Reuse their confirmed result.
      if (!c?.fullName || !c.email || !c.email_verified || !c.phone || !isBrazilianMobilePhone(c.phone)
        || requiresPhysicalDelivery(record.session.cart) && (!a?.zip || !a.street || !a.city || !a.state || !a.number
          || a.complement === undefined || !c.address_verified || !record.session.shipping)) return undefined;
    }
    const missing = async (draft: FiscalRecipient): Promise<FiscalRecipientField[]> => {
      try { await this.gate.assertBeforePayment({ ...record.session, customer: { ...record.session.customer, fiscalRecipient: draft,
        fiscalRecipientMode: fiscalRecipientMode(record.session) } }, { persist: false }); return []; }
      catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        const body = error.getResponse() as { code?: string; fields?: FiscalRecipientField[] };
        if (body.code !== "fiscal_customer_data_required" || !body.fields?.length) throw error;
        return body.fields;
      }
    };
    // A form may have completed the same session while this guided draft was open.
    // Do not write here: the normal chat already loaded the authoritative customer for payment.
    if (state && !selection && !(await missing(await this.gate.resolveRecipient?.(record.session)
      ?? fiscalRecipientFromCustomer(record.session.customer))).length) return undefined;
    let message = ""; let labels: string[] = []; let confirmed: FiscalRecipient | undefined;
    const next = async () => {
      const fields = await missing(state!.draft);
      const field = fields.find(value => value === "name" || value === "taxId")
        ?? (fields.some(value => ["address.postalCode", "address.city", "address.state", "address.cityCode", "address.countryCode"].includes(value)) ? "address.postalCode" : fields[0]);
      if (field) { state!.awaiting = field; message = field === "taxId" && fiscalRecipientMode(record.session) === "buyer"
        ? "Informe seu CPF para continuar." : prompts[field] ?? "Confira os dados do endereço da nota e informe o CEP novamente."; }
      else { state!.awaiting = "confirmation"; message = `Confira o destinatário da nota: ${state!.draft.name}. CPF/CNPJ: ${state!.draft.taxId}. Endereço: ${addressLabel(state!.draft)}. Confirma esses dados?`; labels = ["Confirmar dados fiscais"]; }
    };
    if (!state) {
      const initial = await this.gate.resolveRecipient?.(record.session) ?? fiscalRecipientFromCustomer(record.session.customer);
      const fields = await missing(initial);
      if (!fields.length && !selection) return undefined;
      state = { version: 1, draft: initial, awaiting: "name", finished: false, seen: {} };
      if (!fields.length) { state.finished = true; confirmed = initial; message = "Usaremos seus dados já informados na nota. Escolha a forma de pagamento para continuar."; }
      else await next();
    } else if (state.awaiting === "address_confirmation") {
      if (input.userMessage.trim() === "Confirmar endereço da nota") await next();
      else if (input.userMessage.trim() === "Corrigir CEP") {
        state.draft.address = { number: state.draft.address?.number, complement: state.draft.address?.complement };
        state.awaiting = "address.postalCode"; message = prompts["address.postalCode"]!;
      } else { message = "Confira o endereço da nota: " + addressLabel(state.draft) + ". Confirma o endereço?"; labels = ["Confirmar endereço da nota", "Corrigir CEP"]; }
    } else if (state.awaiting === "confirmation") {
      if (input.userMessage.trim() === "Confirmar dados fiscais") {
        const fields = await missing(state.draft);
        if (fields.length) await next();
        else { confirmed = structuredClone(state.draft); state.finished = true; message = "Dados fiscais salvos. Escolha novamente a forma de pagamento."; }
      } else { message = "Confirme os dados fiscais exibidos para salvar. O pagamento precisa de uma nova ação sua."; labels = ["Confirmar dados fiscais"]; }
    } else {
      const field = state.awaiting;
      const candidate = field.startsWith("address.") ? { address: { [field.slice(8)]: input.userMessage.trim() } } : { [field]: input.userMessage.trim() };
      const validation = validateFiscalRecipient(candidate, [field]);
      if (!validation.valid || field === "taxId" && fiscalRecipientMode(record.session) === "buyer" && validation.recipient.taxId?.length !== 11) message = "Confira o valor informado. " + (field === "taxId" && fiscalRecipientMode(record.session) === "buyer" ? "Informe seu CPF; para empresa, escolha outro destinatário." : prompts[field] ?? "Informe o CEP novamente.");
      else if (field === "address.postalCode") {
        const address = await this.postal.lookup(validation.recipient.address!.postalCode!);
        if (!address || !/^\d{7}$/.test(address.cityCode ?? "")) message = "Não foi possível consultar o CEP. Confira e informe o CEP novamente.";
        else {
          state.draft.address = { ...state.draft.address, ...address }; state.awaiting = "address_confirmation";
          message = "Confira o endereço da nota: " + addressLabel(state.draft) + ". Confirma o endereço?";
          labels = ["Confirmar endereço da nota", "Corrigir CEP"];
        }
      } else { state.draft = { ...state.draft, ...validation.recipient, ...(validation.recipient.address ? { address: { ...state.draft.address, ...validation.recipient.address } } : {}) }; await next(); }
    }
    if (Object.keys(state.seen).length >= 128) throw new BadRequestException("fiscal_collection_limit_reached");
    state.seen[key] = { message, labels };
    if (!input.messageId) state.lastFallback = { textHash, key };
    await this.store.save({ merchantId: input.merchantId, sessionId: input.sessionId, buyerId: record.session.globalUserId,
      version: record.version, state, mode: fiscalRecipientMode(record.session),
      ...(selection === "other" ? { recipient: {} } : {}), ...(confirmed ? { recipient: confirmed, personal: personalPatchForFiscalRecipient(record.session, confirmed) } : {}) });
    return response(message, labels);
  }
}
