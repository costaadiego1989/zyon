/** Presentation of persisted ServiceAppointment facts only. This is not an
 * HTTP DTO or an Orders/fulfillment adapter; T41's read contract is still open. */
export const APPOINTMENT_COLUMNS = [
  { status: "pending", label: "Pendente" }, { status: "scheduled", label: "Agendado" },
  { status: "in_service", label: "Em atendimento" }, { status: "completed", label: "Concluído" },
  { status: "no_show", label: "Não compareceu" }, { status: "cancelled", label: "Cancelado" },
] as const;
export type AppointmentOperationalStatus = typeof APPOINTMENT_COLUMNS[number]["status"];
const PAYMENT_STATUSES = ["pending", "approved", "failed", "cancelled", "refunded", "partially_refunded"] as const;
export interface AppointmentPaymentFact {
  readonly id: string;
  readonly mode: "online" | "at_attendance";
  readonly status: typeof PAYMENT_STATUSES[number];
  readonly amountCents: number;
  readonly currency: string;
  readonly version: number;
  readonly requiresRegularization: boolean | null;
}
export interface AppointmentBoardEntry {
  readonly id: string;
  readonly merchantId: string;
  readonly professionalId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly orderId: string | null;
  readonly orderUnitId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly priceInCents: number;
  readonly currency: string;
  readonly operationalStatus: AppointmentOperationalStatus;
  readonly version: number;
  readonly paymentFacts: readonly AppointmentPaymentFact[] | null;
}
interface UnknownReadMetadata { readonly totalCount: null; readonly pagination: null; readonly allowedActions: null }
export type AppointmentBoardProjection = UnknownReadMetadata & ({
  readonly status: "ready";
  readonly entries: readonly AppointmentBoardEntry[];
  readonly columns: readonly { status: AppointmentOperationalStatus; label: string; entries: readonly AppointmentBoardEntry[] }[];
  /** Count of loaded records only; never an authoritative filtered total. */
  readonly loadedCount: number;
} | { readonly status: "unavailable"; readonly reason: "invalid_appointment_facts" });

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value && value.length <= 191;
const integer = (value: unknown, minimum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const currency = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
function zone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 80) return false;
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format(0); return true; } catch { return false; }
}
function operationalStatus(value: unknown): value is AppointmentOperationalStatus { return APPOINTMENT_COLUMNS.some(column => column.status === value); }
function paymentStatus(value: unknown): value is AppointmentPaymentFact["status"] { return PAYMENT_STATUSES.some(status => status === value); }

function payments(value: unknown, merchantId: string, appointmentId: string): readonly AppointmentPaymentFact[] | null | false {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return false;
  const facts: AppointmentPaymentFact[] = [], ids = new Set<string>();
  for (const item of value) {
    if (!object(item) || !id(item.id) || ids.has(item.id) || item.mode !== "online" && item.mode !== "at_attendance"
      || !paymentStatus(item.status) || !integer(item.amountCents, 0) || !currency(item.currency) || !integer(item.version, 1)
      || item.merchantId !== undefined && item.merchantId !== merchantId
      || item.appointmentId !== undefined && item.appointmentId !== appointmentId
      || item.requiresRegularization !== undefined && typeof item.requiresRegularization !== "boolean") return false;
    ids.add(item.id);
    facts.push(Object.freeze({ id: item.id, mode: item.mode, status: item.status,
      amountCents: item.amountCents, currency: item.currency, version: item.version,
      requiresRegularization: typeof item.requiresRegularization === "boolean" ? item.requiresRegularization : null }));
  }
  return Object.freeze(facts);
}

/** Missing count/pagination/permissions remain unknown until the actual
 * authorized administrative reader supplies its contract. Never infer them. */
export function projectAppointmentBoard(merchantId: string, appointments: readonly unknown[]): AppointmentBoardProjection {
  const unknown = { totalCount: null, pagination: null, allowedActions: null } as const;
  const unavailable = (): AppointmentBoardProjection => ({ status: "unavailable", reason: "invalid_appointment_facts", ...unknown });
  if (!id(merchantId) || !Array.isArray(appointments)) return unavailable();
  const entries: AppointmentBoardEntry[] = [], ids = new Set<string>();
  for (const row of appointments) {
    if (!object(row) || !id(row.id) || ids.has(row.id) || row.merchantId !== merchantId || !id(row.professionalId)
      || !id(row.productId) || !id(row.variantId) || !operationalStatus(row.operationalStatus) || !integer(row.version, 1)
      || !instant(row.startsAt) || !instant(row.endsAt) || Date.parse(row.endsAt) <= Date.parse(row.startsAt) || !zone(row.timeZone)
      || !integer(row.durationMinutes, 1) || !integer(row.priceInCents, 0) || !currency(row.currency)
      || row.orderId != null && !id(row.orderId) || row.orderUnitId != null && !id(row.orderUnitId)) return unavailable();
    const paymentFacts = payments(row.payments, merchantId, row.id);
    if (paymentFacts === false) return unavailable();
    ids.add(row.id);
    entries.push(Object.freeze({ id: row.id, merchantId, professionalId: row.professionalId, productId: row.productId, variantId: row.variantId,
      orderId: row.orderId == null ? null : row.orderId as string, orderUnitId: row.orderUnitId == null ? null : row.orderUnitId as string,
      startsAt: row.startsAt, endsAt: row.endsAt, timeZone: row.timeZone, durationMinutes: row.durationMinutes, priceInCents: row.priceInCents,
      currency: row.currency, operationalStatus: row.operationalStatus, version: row.version, paymentFacts }));
  }
  const list = Object.freeze(entries);
  return Object.freeze({ status: "ready", entries: list, loadedCount: list.length, ...unknown,
    columns: Object.freeze(APPOINTMENT_COLUMNS.map(column => Object.freeze({ ...column, entries: Object.freeze(list.filter(row => row.operationalStatus === column.status)) }))) });
}

export function formatAppointmentStart(entry: Pick<AppointmentBoardEntry, "startsAt" | "timeZone">): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: entry.timeZone }).format(new Date(entry.startsAt));
}
