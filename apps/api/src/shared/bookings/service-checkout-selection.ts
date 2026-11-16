import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import type { CartItem } from "@zyon/shared-types";

export interface ProfessionalCheckoutSelection {
  productId: string;
  variantId: string;
  professionalId: string;
  professionalVersion: number;
  policyVersion: number;
  date: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  durationMinutes: number;
  priceInCents: number;
  currency: string;
  slotId: string;
}
export type ProfessionalSelectionCart = { merchantId: string; cart: { currency: string; items: CartItem[] } };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 191 && value.trim() === value;
const version = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647;

/** Opaque identity, not a bearer capability: canonical SQL is still required. */
export function professionalSlotId(merchantId: string, selected: Omit<ProfessionalCheckoutSelection, "slotId" | "priceInCents" | "currency">): string {
  return createHash("sha256").update(JSON.stringify(["professional-slot-v1", merchantId,
    selected.productId, selected.variantId, selected.professionalId, selected.professionalVersion, selected.policyVersion,
    selected.date, selected.startsAt, selected.endsAt, selected.timeZone, selected.durationMinutes])).digest("hex");
}

/** Old variant-only schedules remain recognizable as legacy, never silently
 * assigned a professional or a booking policy. */
export function hasProfessionalServiceSelection(session: ProfessionalSelectionCart): boolean {
  return session.cart.items.some(item => {
    const schedule: unknown = item.fulfillmentSchedule;
    return record(schedule) && ["professionalId", "professionalVersion", "policyVersion"].some(key => Object.hasOwn(schedule, key));
  });
}

/** Read server-persisted selection fields. This is structural validation only;
 * the transaction-bound availability/price reader owns commercial authority. */
export function readProfessionalCheckoutSelections(session: ProfessionalSelectionCart): ProfessionalCheckoutSelection[] {
  const selections: ProfessionalCheckoutSelection[] = [];
  for (const item of session.cart.items) {
    if (item.fulfillmentStrategy !== "scheduled_service") continue;
    const raw: unknown = item.fulfillmentSchedule;
    if (!record(raw) || item.productType !== "service" || !id(item.product_id) || !id(item.variantId) || item.quantity !== 1
      || !id(raw.professionalId) || !version(raw.professionalVersion) || !version(raw.policyVersion)
      || typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      || typeof raw.startsAt !== "string" || typeof raw.endsAt !== "string"
      || typeof raw.timeZone !== "string" || !raw.timeZone || raw.timeZone.length > 80
      || typeof raw.durationMinutes !== "number" || !Number.isInteger(raw.durationMinutes) || raw.durationMinutes < 5 || raw.durationMinutes > 480
      || !Number.isFinite(item.price) || item.price < 0 || !/^[A-Z]{3}$/.test(session.cart.currency))
      throw new BadRequestException("service_professional_selection_required");
    const start = Date.parse(raw.startsAt), end = Date.parse(raw.endsAt), civilDate = Date.parse(raw.date + "T00:00:00Z");
    const price = Math.round(item.price * 100);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== raw.durationMinutes * 60_000
      || !Number.isFinite(civilDate) || new Date(civilDate).toISOString().slice(0, 10) !== raw.date
      || !Number.isSafeInteger(price) || price > 2_147_483_647)
      throw new BadRequestException("service_professional_selection_invalid");
    try { new Intl.DateTimeFormat("pt-BR", { timeZone: raw.timeZone }).format(); }
    catch { throw new BadRequestException("service_professional_selection_invalid"); }
    const selected = { productId: item.product_id, variantId: item.variantId, professionalId: raw.professionalId,
      professionalVersion: raw.professionalVersion, policyVersion: raw.policyVersion, date: raw.date,
      startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), timeZone: raw.timeZone,
      durationMinutes: raw.durationMinutes, priceInCents: price, currency: session.cart.currency };
    const complete = { ...selected, slotId: professionalSlotId(session.merchantId, selected) };
    if (selections.some(previous => previous.professionalId === complete.professionalId
      && previous.startsAt < complete.endsAt && previous.endsAt > complete.startsAt))
      throw new BadRequestException("service_slot_quantity_invalid");
    selections.push(complete);
  }
  return selections;
}

/** Namespace new professional capacity separately from old variant capacity. */
export function professionalHoldRequests(selections: ProfessionalCheckoutSelection[]) {
  return selections.map(slot => ({ resourceId: "professional:" + slot.professionalId, slotId: slot.slotId,
    startsAt: slot.startsAt, endsAt: slot.endsAt }));
}
