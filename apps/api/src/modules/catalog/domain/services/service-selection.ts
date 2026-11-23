import { BadRequestException } from "@nestjs/common";
import type { CartItem } from "@zyon/shared-types";
import { addBusinessDays, businessDateKey, DASHBOARD_TIME_ZONE } from "../../../../shared/analytics/business-period.js";
import { readProfessionalCheckoutSelections, type ProfessionalCheckoutSelection } from "../../../../shared/bookings/service-checkout-selection.js";
import { parseServiceInstant } from "./professional-availability-input.js";

export interface CurrentServiceSelectionOption extends ProfessionalCheckoutSelection {
  merchantId: string;
  productName: string;
  professionalName: string;
}
export interface CurrentServiceProfessionalChoice {
  merchantId: string;
  productId: string;
  variantId: string;
  professionalId: string;
  professionalName: string;
  professionalVersion: number;
}
export interface CurrentServiceSelectionSnapshot {
  merchantId: string;
  asOf: string;
  /** All relevant pages, not merely the currently displayed page. */
  complete: boolean;
  options: readonly CurrentServiceSelectionOption[];
  /** Eligible current professionals, including those without an available slot.
   * Slot completeness cannot establish professional-name uniqueness. */
  professionalRoster: { complete: boolean; professionals: readonly CurrentServiceProfessionalChoice[] };
}
type DateHint = { kind: "absolute"; value: string } | { kind: "relative"; value: "today" | "tomorrow" | "day_after_tomorrow" }
  | { kind: "ambiguous"; values?: string[] };
type TimeHint = { kind: "exact"; value: string } | { kind: "ambiguous"; values?: string[] };
/** Untrusted semantic hints. IDs, commercial facts and actions do not belong here. */
export type ServiceSelectionInterpretation = { kind: "selection"; professionalName?: string; date?: DateHint; time?: TimeHint }
  | { kind: "side_question" } | { kind: "unclear" };
type Safety = { requiresRevalidation: true; authorizesPayment: false; authorizesConfirmation: false };
type ClarificationReason = "choose_current_option" | "choose_professional" | "choose_date" | "choose_time"
  | "no_current_match" | "refresh_current_options" | "more_current_options" | "more_current_professionals";
export type ServiceSelectionResolution = Safety & (
  | { kind: "resolved"; selection: CurrentServiceSelectionOption; displayDate: string; displayTime: string;
      displayTimeZone: "America/Sao_Paulo"; sourceAsOf: string }
  | { kind: "clarification"; reason: ClarificationReason; options: CurrentServiceSelectionOption[]; professionals: CurrentServiceProfessionalChoice[]; hasMore: boolean;
      previous?: CurrentServiceSelectionOption; sourceAsOf?: string }
  | { kind: "unchanged"; selection?: CurrentServiceSelectionOption }
);
export interface ServiceSelectionInput {
  /** Authenticated channel context; never a model/body tenant override. */
  merchantId: string;
  channel: "text" | "voice";
  now: Date;
  interpretation: unknown;
  current: CurrentServiceSelectionSnapshot | null;
  previous?: CurrentServiceSelectionOption;
  /** Only a verified active menu/button selection in the channel adapter.
   * A model interpretation is not allowed to manufacture this field. */
  explicitSlotId?: string;
}
const safety = { requiresRevalidation: true, authorizesPayment: false, authorizesConfirmation: false } as const;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 191 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const label = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 500;
const name = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
const clockTime = (value: unknown): value is string => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function civilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function interpretation(raw: unknown): ServiceSelectionInterpretation {
  const invalid = () => { throw new BadRequestException("service_selection_interpretation_invalid"); };
  if (!object(raw)) return invalid();
  if (raw.kind === "side_question" || raw.kind === "unclear") {
    if (!keys(raw, ["kind"])) return invalid();
    return { kind: raw.kind };
  }
  if (raw.kind !== "selection" || !keys(raw, ["kind", "professionalName", "date", "time"])
    || raw.professionalName !== undefined && !label(raw.professionalName)) return invalid();
  const date = raw.date, time = raw.time;
  if (date !== undefined && (!object(date) || !(date.kind === "absolute" && keys(date, ["kind", "value"]) && civilDate(date.value)
    || date.kind === "relative" && keys(date, ["kind", "value"]) && typeof date.value === "string" && ["today", "tomorrow", "day_after_tomorrow"].includes(date.value)
    || date.kind === "ambiguous" && keys(date, ["kind", "values"]) && (date.values === undefined || Array.isArray(date.values)
      && date.values.length <= 31 && date.values.every(civilDate))))) return invalid();
  if (time !== undefined && (!object(time) || !(time.kind === "exact" && keys(time, ["kind", "value"]) && clockTime(time.value)
    || time.kind === "ambiguous" && keys(time, ["kind", "values"]) && (time.values === undefined || Array.isArray(time.values)
      && time.values.length <= 24 && time.values.every(clockTime))))) return invalid();
  return { kind: "selection", ...(raw.professionalName !== undefined ? { professionalName: raw.professionalName as string } : {}),
    ...(date !== undefined ? { date: structuredClone(date) as DateHint } : {}), ...(time !== undefined ? { time: structuredClone(time) as TimeHint } : {}) };
}
function canonicalOption(raw: CurrentServiceSelectionOption, merchantId: string): CurrentServiceSelectionOption | undefined {
  if (!object(raw) || raw.merchantId !== merchantId) throw new BadRequestException("service_selection_source_scope_invalid");
  if (!label(raw.productName) || !label(raw.professionalName)) return;
  try {
    const item: CartItem = { sku: raw.variantId, name: raw.productName, quantity: 1, price: raw.priceInCents / 100,
      product_id: raw.productId, variantId: raw.variantId, productType: "service", fulfillmentStrategy: "scheduled_service",
      fulfillmentSchedule: { professionalId: raw.professionalId, professionalVersion: raw.professionalVersion, policyVersion: raw.policyVersion,
        slotId: raw.slotId, date: raw.date, startsAt: raw.startsAt, endsAt: raw.endsAt, timeZone: raw.timeZone, durationMinutes: raw.durationMinutes } };
    const [selection] = readProfessionalCheckoutSelections({ merchantId, cart: { currency: raw.currency, items: [item] } });
    if (!selection || selection.slotId !== raw.slotId || selection.priceInCents !== raw.priceInCents) return;
    return { ...selection, merchantId, productName: raw.productName, professionalName: raw.professionalName };
  } catch { return; }
}
function canonicalProfessional(raw: CurrentServiceProfessionalChoice, merchantId: string): CurrentServiceProfessionalChoice | undefined {
  if (!object(raw) || raw.merchantId !== merchantId) throw new BadRequestException("service_selection_source_scope_invalid");
  if (!identifier(raw.productId) || !identifier(raw.variantId) || !identifier(raw.professionalId) || !label(raw.professionalName)
    || !Number.isSafeInteger(raw.professionalVersion) || raw.professionalVersion < 1 || raw.professionalVersion > 2_147_483_647) return;
  return { merchantId, productId: raw.productId, variantId: raw.variantId, professionalId: raw.professionalId,
    professionalName: raw.professionalName, professionalVersion: raw.professionalVersion };
}
const professionalKey = (value: Pick<CurrentServiceProfessionalChoice, "productId" | "variantId" | "professionalId">) => JSON.stringify([value.productId, value.variantId, value.professionalId]);
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: DASHBOARD_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function displayTime(option: CurrentServiceSelectionOption): string {
  const parts = timeFormatter.formatToParts(new Date(option.startsAt));
  return parts.find(part => part.type === "hour")!.value + ":" + parts.find(part => part.type === "minute")!.value;
}
const displayDate = (option: CurrentServiceSelectionOption) => businessDateKey(new Date(option.startsAt));

/** Resolve a proposal only. SQL/Redis, T40 admission and explicit financial
 * commands remain authoritative after every result, including voice results. */
export function resolveServiceSelection(input: ServiceSelectionInput): ServiceSelectionResolution {
  if (!identifier(input.merchantId) || !["text", "voice"].includes(input.channel) || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())
    || input.explicitSlotId !== undefined && !identifier(input.explicitSlotId)) throw new BadRequestException("service_selection_input_invalid");
  const hints = interpretation(input.interpretation), now = new Date(input.now.getTime());
  let previous: CurrentServiceSelectionOption | undefined;
  if (input.previous) {
    if (input.previous.merchantId !== input.merchantId) throw new BadRequestException("service_selection_state_scope_invalid");
    previous = canonicalOption(input.previous, input.merchantId);
    if (!previous) throw new BadRequestException("service_selection_state_invalid");
  }
  if (hints.kind === "side_question") return { kind: "unchanged", ...(previous ? { selection: previous } : {}), ...safety };
  let sourceAsOf: string | undefined;
  let complete = false;
  let rosterComplete = false;
  let professionals: CurrentServiceProfessionalChoice[] = [];
  const clarify = (reason: ClarificationReason, options: CurrentServiceSelectionOption[] = []): ServiceSelectionResolution => ({
    kind: "clarification", reason, options: options.slice(0, 20), professionals: professionals.slice(0, 20).map(value => ({ ...value })),
    hasMore: !complete || !rosterComplete || options.length > 20 || professionals.length > 20,
    ...(previous ? { previous } : {}), ...(sourceAsOf ? { sourceAsOf } : {}), ...safety });
  const source = input.current;
  if (!source) return clarify("refresh_current_options");
  if (source.merchantId !== input.merchantId) throw new BadRequestException("service_selection_source_scope_invalid");
  if (typeof source.complete !== "boolean" || !Array.isArray(source.options) || source.options.length > 100
    || !object(source.professionalRoster) || typeof source.professionalRoster.complete !== "boolean"
    || !Array.isArray(source.professionalRoster.professionals) || source.professionalRoster.professionals.length > 100) return clarify("refresh_current_options");
  try {
    const instant = parseServiceInstant(source.asOf);
    if (instant > now) return clarify("refresh_current_options");
    sourceAsOf = instant.toISOString();
  } catch { return clarify("refresh_current_options"); }
  complete = source.complete;
  rosterComplete = source.professionalRoster.complete;
  const roster = new Map<string, CurrentServiceProfessionalChoice>();
  for (const raw of source.professionalRoster.professionals) {
    const person = canonicalProfessional(raw, input.merchantId);
    if (!person) return clarify("refresh_current_options");
    const duplicate = roster.get(professionalKey(person));
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(person)) return clarify("refresh_current_options");
    roster.set(professionalKey(person), person);
  }
  const unique = new Map<string, CurrentServiceSelectionOption>();
  for (const raw of source.options) {
    const value = canonicalOption(raw, input.merchantId);
    if (!value) return clarify("refresh_current_options");
    const person = roster.get(professionalKey(value));
    if (!person || person.professionalVersion !== value.professionalVersion || person.professionalName !== value.professionalName) return clarify("refresh_current_options");
    const duplicate = unique.get(value.slotId);
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(value)) return clarify("refresh_current_options");
    unique.set(value.slotId, value);
  }
  professionals = [...roster.values()];
  let choices = [...unique.values()].filter(value => Date.parse(value.startsAt) > now.getTime());
  if (hints.kind === "unclear") return clarify("choose_current_option", choices);
  const hasHint = hints.professionalName !== undefined || hints.date !== undefined || hints.time !== undefined || input.explicitSlotId !== undefined;
  if (previous && !input.explicitSlotId) {
    choices = choices.filter(value => value.productId === previous!.productId && value.variantId === previous!.variantId);
    professionals = professionals.filter(value => value.productId === previous!.productId && value.variantId === previous!.variantId);
  }
  if (hints.professionalName) {
    professionals = professionals.filter(value => name(value.professionalName) === name(hints.professionalName!));
    choices = choices.filter(value => name(value.professionalName) === name(hints.professionalName!));
    if (!input.explicitSlotId && new Set(professionals.map(value => value.professionalId)).size > 1) return clarify("choose_professional", choices);
  } else if (previous && !input.explicitSlotId) {
    choices = choices.filter(value => value.professionalId === previous!.professionalId);
    professionals = professionals.filter(value => value.professionalId === previous!.professionalId);
  }
  if (!rosterComplete && !input.explicitSlotId) return clarify("more_current_professionals", choices);
  if (hints.date?.kind === "ambiguous") {
    const values = hints.date.values;
    return clarify("choose_date", values?.length ? choices.filter(value => values.includes(displayDate(value))) : choices);
  }
  const date = hints.date?.kind === "absolute" ? hints.date.value : hints.date?.kind === "relative"
    ? addBusinessDays(businessDateKey(now), ({ today: 0, tomorrow: 1, day_after_tomorrow: 2 } as const)[hints.date.value])
    : previous && !input.explicitSlotId ? displayDate(previous) : undefined;
  if (date) choices = choices.filter(value => displayDate(value) === date);
  if (hints.time?.kind === "ambiguous") {
    const values = hints.time.values;
    return clarify("choose_time", values?.length ? choices.filter(value => values.includes(displayTime(value))) : choices);
  }
  const time = hints.time?.kind === "exact" ? hints.time.value : previous && !input.explicitSlotId ? displayTime(previous) : undefined;
  if (time) choices = choices.filter(value => displayTime(value) === time);
  if (input.explicitSlotId) choices = choices.filter(value => value.slotId === input.explicitSlotId);
  if (!complete) return clarify("more_current_options", choices);
  if (!hasHint) return clarify("choose_current_option", choices);
  if (!choices.length) return clarify("no_current_match");
  if (!input.explicitSlotId && !date) return clarify("choose_date", choices);
  if (!input.explicitSlotId && !time) return clarify("choose_time", choices);
  if (choices.length !== 1) return clarify("choose_current_option", choices);
  const selected = choices[0]!;
  return { kind: "resolved", selection: selected, displayDate: displayDate(selected), displayTime: displayTime(selected),
    displayTimeZone: DASHBOARD_TIME_ZONE, sourceAsOf: sourceAsOf!, ...safety };
}
