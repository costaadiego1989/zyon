/** Availability is public navigation; all cart, preparation and confirmation commands still require the real buyer. */
export type ServiceBookingContext = { productId: string; variantId: string; serviceName: string; professional?: { id: string; version: number; name?: string } };
export type ServiceProfessional = { id: string; name: string; version: number; timeZone: string; profile?: unknown };
export type ServiceSelection = { productId: string; variantId: string; professionalId: string; professionalVersion: number; policyVersion: number; date: string; startsAt: string; endsAt: string; timeZone: string; durationMinutes: number; priceInCents: number; currency: string; slotId: string };
export type ServiceReview = { selection: ServiceSelection; service: { name: string }; professional: { name: string }; parent_cart_fingerprint: string; policy: { version: number; paymentMode: "online" | "at_attendance"; holdEnabled: boolean; holdMinutes: number | null } };
export type ServicePreparation = { session_id: string; replayed: boolean; confirmed: false; cart_fingerprint: string; payment_mode: "online" | "at_attendance"; policy_version: number; requires_hold: boolean; service_slot_hold: null | { expiresAt: string; slots: Array<{ resourceId: string; slotId: string; startsAt: string; endsAt: string }> }; selections: Array<ServiceSelection & { productName: string; professionalName: string }> };
export type ServiceConfirmation = { replayed: boolean; appointments: Array<{ id: string; professionalId: string; productId: string; variantId: string; startsAt: string; endsAt: string; timeZone: string; durationMinutes: number; priceInCents: number; currency: string; operationalStatus: string; version: number; payments: Array<{ id: string; mode: string; status: string; amountCents: number; currency: string; receivedAt: string | null; requiresRegularization: boolean }> }> };
export type ServiceBookingReadAccess = { merchantId: string; embedToken: string; apiBaseUrl: string; embedApiBaseUrl?: string };
export type ServiceBookingAccess = ServiceBookingReadAccess & { buyerAccessToken: string; globalUserId: string };

type ObjectValue = Record<string, unknown>;
const record = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647;
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
function civil(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function exact(value: ObjectValue, keys: string[]) { return Object.keys(value).every(key => keys.includes(key)); }
function invalid(): never { throw new ServiceBookingRequestError(502, "service_booking_response_invalid"); }
function inputInvalid(): never { throw new ServiceBookingRequestError(400, "service_booking_selection_invalid"); }
function offer(value: ServiceBookingContext) { if (!record(value) || !text(value.productId) || !text(value.variantId)) inputInvalid(); return { productId: value.productId, variantId: value.variantId }; }
function selection(value: unknown): ServiceSelection {
  if (!record(value) || !text(value.productId) || !text(value.variantId) || !text(value.professionalId) || !positive(value.professionalVersion) || !positive(value.policyVersion) || !civil(value.date) || !instant(value.startsAt) || !instant(value.endsAt) || Date.parse(value.endsAt) <= Date.parse(value.startsAt) || !text(value.timeZone) || !positive(value.durationMinutes) || value.durationMinutes < 5 || value.durationMinutes > 480 || Date.parse(value.endsAt) - Date.parse(value.startsAt) !== value.durationMinutes * 60000 || !cents(value.priceInCents) || typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) || !fingerprint(value.slotId)) invalid();
  return { productId: value.productId, variantId: value.variantId, professionalId: value.professionalId, professionalVersion: value.professionalVersion, policyVersion: value.policyVersion, date: value.date, startsAt: value.startsAt, endsAt: value.endsAt, timeZone: value.timeZone, durationMinutes: value.durationMinutes, priceInCents: value.priceInCents, currency: value.currency, slotId: value.slotId };
}
function sameSelection(a: ServiceSelection, b: ServiceSelection) { return Object.keys(a).every(key => a[key as keyof ServiceSelection] === b[key as keyof ServiceSelection]); }
/** Old blocks remain valid but cannot supply a guessed offer or private command. */
export function serviceBookingContext(data: unknown): ServiceBookingContext | null {
  if (!record(data) || !["professionals", "dates", "slots", "selection", "selection_resolution"].includes(String(data.kind)) || !record(data.context)) return null;
  const c = data.context;
  if (!exact(c, ["productId", "variantId", "serviceName", "professional"]) || !text(c.productId) || !text(c.variantId) || !text(c.serviceName)) return null;
  if (c.professional !== undefined && (!record(c.professional) || !exact(c.professional, ["id", "version", "name"]) || !text(c.professional.id) || !positive(c.professional.version) || c.professional.name !== undefined && !text(c.professional.name))) return null;
  return { productId: c.productId, variantId: c.variantId, serviceName: c.serviceName, ...(c.professional ? { professional: { ...(c.professional as ServiceBookingContext["professional"])! } } : {}) };
}
export class ServiceBookingRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = "ServiceBookingRequestError"; }
}
export class ServiceBookingUncertainError extends Error {
  constructor() { super("service_booking_outcome_unknown"); this.name = "ServiceBookingUncertainError"; }
}
/** Public facts only. No buyer header, cart fingerprint or write method is exposed. */
export class ServiceBookingReadClient {
  private readonly readAccess: ServiceBookingReadAccess;
  constructor(access: ServiceBookingReadAccess) {
    if (![access.merchantId, access.embedToken].every(value => typeof value === "string" && value.trim())) throw new ServiceBookingRequestError(401, "service_booking_read_access_required");
    this.readAccess = { merchantId: access.merchantId, embedToken: access.embedToken, apiBaseUrl: access.apiBaseUrl, embedApiBaseUrl: access.embedApiBaseUrl };
  }
  protected readHeaders(): Record<string, string> { return { Authorization: `Bearer ${this.readAccess.embedToken}` }; }
  private async browse(path: string, query: Record<string, string>, _body: undefined, signal?: AbortSignal): Promise<unknown> {
    const base = (this.readAccess.embedApiBaseUrl ?? this.readAccess.apiBaseUrl).replace(/\/$/, "");
    const response = await fetch(`${base}/embed/${path}?${new URLSearchParams(query)}`, {
      method: "GET", cache: "no-store", signal, headers: this.readHeaders(),
    });
    let payload: unknown; try { payload = await response.json(); } catch { invalid(); }
    if (!response.ok) {
      const code = record(payload) && typeof payload.code === "string" ? payload.code : "service_booking_unavailable";
      throw new ServiceBookingRequestError(response.status, /^[a-z0-9_]{1,100}$/.test(code) ? code : "service_booking_unavailable");
    }
    return payload;
  }
  async professionals(context: ServiceBookingContext, signal?: AbortSignal): Promise<{ professionals: ServiceProfessional[]; has_more: boolean }> {
    const data = await this.browse("service-booking/professionals", offer(context), undefined, signal);
    if (!record(data) || !Array.isArray(data.professionals) || data.professionals.length > 50 || typeof data.has_more !== "boolean") invalid();
    const professionals = data.professionals.map(value => { if (!record(value) || !text(value.id) || !text(value.name) || !positive(value.version) || !text(value.timeZone)) invalid(); return { id: value.id, name: value.name, version: value.version, timeZone: value.timeZone }; });
    if (new Set(professionals.map(p => p.id)).size !== professionals.length) invalid();
    return { professionals, has_more: data.has_more };
  }
  async dates(context: ServiceBookingContext, professionalId: string, fromDate: string, toDate: string, signal?: AbortSignal): Promise<{ dates: string[]; professional_version: number; policy_version: number; time_zone: string }> {
    if (!text(professionalId) || !civil(fromDate) || !civil(toDate) || toDate < fromDate || (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000 >= 31) inputInvalid();
    const data = await this.browse("service-booking/dates", { ...offer(context), professionalId, fromDate, toDate }, undefined, signal);
    if (!record(data) || !Array.isArray(data.dates) || data.dates.length > 31 || !positive(data.professional_version) || !positive(data.policy_version) || !text(data.time_zone) || !data.dates.every(date => civil(date) && date >= fromDate && date <= toDate) || new Set(data.dates).size !== data.dates.length) invalid();
    return { dates: data.dates as string[], professional_version: data.professional_version, policy_version: data.policy_version, time_zone: data.time_zone };
  }
  async slots(context: ServiceBookingContext, professionalId: string, date: string, signal?: AbortSignal): Promise<{ selections: ServiceSelection[] }> {
    if (!text(professionalId) || !civil(date)) inputInvalid();
    const data = await this.browse("service-booking/slots", { ...offer(context), professionalId, date }, undefined, signal);
    if (!record(data) || !Array.isArray(data.selections) || data.selections.length > 300) invalid();
    const selections = data.selections.map(selection);
    if (selections.some(s => s.productId !== context.productId || s.variantId !== context.variantId || s.professionalId !== professionalId || s.date !== date) || new Set(selections.map(s => s.slotId)).size !== selections.length) invalid();
    return { selections };
  }
}
export class ServiceBookingClient extends ServiceBookingReadClient {
  private readonly access: ServiceBookingAccess;
  private readonly commands = new WeakMap<ServicePreparation, string>();
  constructor(access: ServiceBookingAccess) {
    super(access);
    if (![access.merchantId, access.embedToken, access.buyerAccessToken, access.globalUserId].every(value => typeof value === "string" && value.trim())) throw new ServiceBookingRequestError(401, "service_booking_authentication_required");
    this.access = { ...access };
  }
  protected override readHeaders(): Record<string, string> { return { Authorization: `Bearer ${this.access.embedToken}`, "x-buyer-access-token": this.access.buyerAccessToken }; }
  private async request(path: string, query?: Record<string, string>, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const base = (this.access.embedApiBaseUrl ?? this.access.apiBaseUrl).replace(/\/$/, "");
    const suffix = query ? `?${new URLSearchParams(query)}` : "";
    let response: Response;
    try { response = await fetch(`${base}/embed/${path}${suffix}`, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal, headers: { Authorization: `Bearer ${this.access.embedToken}`, "x-buyer-access-token": this.access.buyerAccessToken, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch (error) { if (body !== undefined) throw new ServiceBookingUncertainError(); throw error; }
    let payload: unknown;
    try { payload = await response.json(); } catch { if (body !== undefined) throw new ServiceBookingUncertainError(); invalid(); }
    if (!response.ok) {
      if (body !== undefined && response.status >= 500) throw new ServiceBookingUncertainError();
      const code = record(payload) && typeof payload.code === "string" ? payload.code : record(payload) && typeof payload.message === "string" ? payload.message : "service_booking_unavailable";
      throw new ServiceBookingRequestError(response.status, /^[a-z0-9_]{1,100}$/.test(code) ? code : "service_booking_unavailable");
    }
    return payload;
  }
  async select(value: ServiceSelection, signal?: AbortSignal): Promise<ServiceReview> {
    let submitted: ServiceSelection; try { submitted = selection(value); } catch { inputInvalid(); }
    const data = await this.request("service-booking/select", undefined, { selection: submitted }, signal);
    try {
      if (!record(data) || !record(data.service) || !text(data.service.name) || !record(data.professional) || !text(data.professional.name) || !fingerprint(data.parent_cart_fingerprint) || !record(data.policy) || !positive(data.policy.version) || !["online", "at_attendance"].includes(String(data.policy.paymentMode)) || typeof data.policy.holdEnabled !== "boolean" || data.policy.holdMinutes !== null && !positive(data.policy.holdMinutes)) invalid();
      const selected = selection(data.selection); if (!sameSelection(submitted, selected) || data.policy.version !== selected.policyVersion) invalid();
      return { selection: selected, service: { name: data.service.name }, professional: { name: data.professional.name }, parent_cart_fingerprint: data.parent_cart_fingerprint, policy: { version: data.policy.version, paymentMode: data.policy.paymentMode as "online" | "at_attendance", holdEnabled: data.policy.holdEnabled, holdMinutes: data.policy.holdMinutes as number | null } };
    } catch { throw new ServiceBookingUncertainError(); }
  }
  async prepare(review: ServiceReview, signal?: AbortSignal): Promise<ServicePreparation> {
    if (!fingerprint(review.parent_cart_fingerprint)) inputInvalid();
    const submitted = selection(review.selection);
    const data = await this.request("service-booking/prepare", undefined, { selection: submitted, parent_cart_fingerprint: review.parent_cart_fingerprint }, signal);
    try {
      if (!record(data) || !text(data.session_id) || typeof data.replayed !== "boolean" || data.confirmed !== false || !fingerprint(data.cart_fingerprint) || data.payment_mode !== review.policy.paymentMode || data.policy_version !== submitted.policyVersion || data.requires_hold !== review.policy.holdEnabled || !Array.isArray(data.selections) || !data.selections.length || data.selections.length > 100) invalid();
      const rows = data.selections.map(value => { const tuple = selection(value); if (!record(value) || !text(value.productName) || !text(value.professionalName)) invalid(); return { ...tuple, productName: value.productName, professionalName: value.professionalName }; });
      if (rows.filter(row => sameSelection(submitted, row)).length !== 1 || new Set(rows.map(row => row.slotId)).size !== rows.length) invalid();
      let hold: ServicePreparation["service_slot_hold"] = null;
      if (data.service_slot_hold !== null) {
        const h = data.service_slot_hold;
        if (!record(h) || !instant(h.expiresAt) || !Array.isArray(h.slots) || !h.slots.length) invalid();
        hold = { expiresAt: h.expiresAt, slots: h.slots.map(value => { if (!record(value) || !text(value.resourceId) || !text(value.slotId) || !instant(value.startsAt) || !instant(value.endsAt)) invalid(); return { resourceId: value.resourceId, slotId: value.slotId, startsAt: value.startsAt, endsAt: value.endsAt }; }) };
      }
      if (data.requires_hold && !hold) invalid();
      return { session_id: data.session_id, replayed: data.replayed, confirmed: false, cart_fingerprint: data.cart_fingerprint, payment_mode: data.payment_mode as ServicePreparation["payment_mode"], policy_version: data.policy_version as number, requires_hold: data.requires_hold, service_slot_hold: hold, selections: rows };
    } catch { throw new ServiceBookingUncertainError(); }
  }
  async confirm(prepared: ServicePreparation, signal?: AbortSignal): Promise<ServiceConfirmation> {
    if (prepared.payment_mode !== "at_attendance") throw new ServiceBookingRequestError(409, "service_online_payment_required");
    if (!text(prepared.session_id) || !fingerprint(prepared.cart_fingerprint) || prepared.confirmed !== false) inputInvalid();
    let command = this.commands.get(prepared); if (!command) { command = crypto.randomUUID(); this.commands.set(prepared, command); }
    const data = await this.request("service-appointments/confirm", undefined, { session_id: prepared.session_id, command_id: command, cart_fingerprint: prepared.cart_fingerprint }, signal);
    try {
      if (!record(data) || typeof data.replayed !== "boolean" || !Array.isArray(data.appointments) || data.appointments.length !== prepared.selections.length) invalid();
      const matched = new Set<ServiceSelection>();
      const appointments = data.appointments.map(value => {
        if (!record(value) || !text(value.id) || !text(value.operationalStatus) || !positive(value.version) || !Array.isArray(value.payments)) invalid();
        const original = prepared.selections.find(s => s.productId === value.productId && s.variantId === value.variantId && s.professionalId === value.professionalId && s.startsAt === value.startsAt && s.endsAt === value.endsAt);
        if (!original || matched.has(original) || value.priceInCents !== original.priceInCents || value.currency !== original.currency || value.timeZone !== original.timeZone || value.durationMinutes !== original.durationMinutes) invalid();
        matched.add(original);
        const payments = value.payments.map(p => { if (!record(p) || !text(p.id) || !text(p.mode) || !text(p.status) || !cents(p.amountCents) || typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency) || p.receivedAt !== null && !instant(p.receivedAt) || typeof p.requiresRegularization !== "boolean") invalid(); return { id: p.id, mode: p.mode, status: p.status, amountCents: p.amountCents, currency: p.currency, receivedAt: p.receivedAt as string | null, requiresRegularization: p.requiresRegularization }; });
        return { id: value.id, professionalId: original.professionalId, productId: original.productId, variantId: original.variantId, startsAt: original.startsAt, endsAt: original.endsAt, timeZone: original.timeZone, durationMinutes: original.durationMinutes, priceInCents: original.priceInCents, currency: original.currency, operationalStatus: value.operationalStatus, version: value.version, payments };
      });
      if (new Set(appointments.map(a => a.id)).size !== appointments.length) invalid();
      return { replayed: data.replayed, appointments };
    } catch { throw new ServiceBookingUncertainError(); }
  }
}
