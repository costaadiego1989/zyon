import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ServiceAppointmentAdminState, ServiceAppointmentAdminItem, ServiceAppointmentAdminList, ServiceAppointmentAdminDetail } from "@zyon/shared-types";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { validateAvailabilityWindow } from "../../catalog/domain/services/professional-availability.js";
import { addBusinessDays, businessDateKey, businessDayStart } from "../../../shared/analytics/business-period.js";
import { parseServiceInstant } from "../../catalog/domain/services/professional-availability-input.js";

const timeZone: ServiceAppointmentAdminList["timeZone"] = "America/Sao_Paulo";
const statuses: ServiceAppointmentAdminState[] = ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value && value.length <= 191 && !/[\x00-\x1f\x7f]/.test(value);
interface Cursor { selector: string; startsAt: Date; id: string }
function cursor(value: unknown): Cursor | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new BadRequestException("appointment_cursor_invalid");
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 3 || typeof decoded[0] !== "string" || !/^[a-f0-9]{64}$/.test(decoded[0]) || !id(decoded[2])) throw new Error("invalid");
    return { selector: decoded[0], startsAt: parseServiceInstant(decoded[1], "appointment_cursor_invalid"), id: decoded[2] };
  } catch { throw new BadRequestException("appointment_cursor_invalid"); }
}
export function parseAppointmentListQuery(raw: Record<string, unknown>) {
  if (!object(raw) || Object.keys(raw).some(key => !["fromDate", "toDate", "professionalId", "categoryId", "productId", "status", "limit", "cursor"].includes(key)))
    throw new BadRequestException("appointment_list_query_invalid");
  const fromDate = raw.fromDate, toDate = raw.toDate;
  if (typeof fromDate !== "string" || typeof toDate !== "string") throw new BadRequestException("appointment_period_invalid");
  validateAvailabilityWindow({ fromDate, toDate, now: new Date() });
  const nextDay = addBusinessDays(toDate, 1);
  const from = businessDayStart(fromDate), to = businessDayStart(nextDay);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from
    || businessDateKey(from) !== fromDate || businessDateKey(to) !== nextDay) throw new BadRequestException("appointment_period_invalid");
  for (const key of ["professionalId", "categoryId", "productId"]) if (raw[key] !== undefined && !id(raw[key])) throw new BadRequestException("appointment_filter_invalid");
  if (raw.status !== undefined && (typeof raw.status !== "string" || !statuses.includes(raw.status as ServiceAppointmentAdminState))) throw new BadRequestException("appointment_status_invalid");
  const limit = raw.limit === undefined ? 25 : typeof raw.limit === "string" && /^\d+$/.test(raw.limit) ? Number(raw.limit) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("appointment_limit_invalid");
  return { from, to, professionalId: raw.professionalId as string | undefined, categoryId: raw.categoryId as string | undefined,
    productId: raw.productId as string | undefined, status: raw.status as ServiceAppointmentAdminState | undefined, limit, cursor: cursor(raw.cursor) };
}
const selection = {
  id: true, merchantId: true, professionalId: true, productId: true, variantId: true, startsAt: true, endsAt: true,
  timeZone: true, durationMinutes: true, priceInCents: true, currency: true, policyVersion: true, operationalStatus: true, origin: true, version: true,
  customerSnapshot: true, product: { select: { name: true, categoryId: true } }, professional: { select: { publicName: true } },
  payments: { orderBy: { id: "asc" }, take: 101, select: { id: true, mode: true, status: true, amountCents: true, currency: true,
    version: true, requiresRegularization: true, receivedAt: true } },
} satisfies Prisma.ServiceAppointmentSelect;
type Row = Prisma.ServiceAppointmentGetPayload<{ select: typeof selection }>;
function project(appointment: Row): ServiceAppointmentAdminItem {
  if (appointment.payments.length > 100) throw new ServiceUnavailableException("appointment_financial_source_limit");
  const source = object(appointment.customerSnapshot) ? appointment.customerSnapshot : {}, customer: ServiceAppointmentAdminItem["customer"] = {};
  for (const key of ["name", "phone", "email"] as const) if (typeof source[key] === "string") customer[key] = source[key];
  return { id: appointment.id, merchantId: appointment.merchantId, professionalId: appointment.professionalId, professionalName: appointment.professional.publicName,
    productId: appointment.productId, serviceName: appointment.product.name, categoryId: appointment.product.categoryId, variantId: appointment.variantId,
    startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt.toISOString(), timeZone: appointment.timeZone,
    durationMinutes: appointment.durationMinutes, priceInCents: appointment.priceInCents, currency: appointment.currency,
    policyVersion: appointment.policyVersion, operationalStatus: appointment.operationalStatus, origin: appointment.origin, version: appointment.version, customer,
    payments: appointment.payments.map(payment => ({ id: payment.id, mode: payment.mode, status: payment.status, amountCents: payment.amountCents,
      currency: payment.currency, version: payment.version, requiresRegularization: payment.requiresRegularization, receivedAt: payment.receivedAt?.toISOString() ?? null })) };
}
async function asOf(tx: Prisma.TransactionClient): Promise<string> {
  const [value] = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`;
  if (!(value?.asOf instanceof Date) || !Number.isFinite(value.asOf.getTime())) throw new ServiceUnavailableException("appointment_read_clock_unavailable");
  return value.asOf.toISOString();
}
/** Read canonical appointments only; payment facts never determine attendance. */
export class ReadServiceAppointments {
  constructor(private readonly prisma: PrismaClient) {}
  async list(actor: ServiceActor, raw: Record<string, unknown>): Promise<ServiceAppointmentAdminList> {
    actor = { ...actor };
    const query = parseAppointmentListQuery(raw), selector = createHash("sha256").update(JSON.stringify(["appointment-list-v1", actor.merchantId,
      query.from.toISOString(), query.to.toISOString(), query.professionalId ?? null, query.categoryId ?? null, query.productId ?? null, query.status ?? null, query.limit])).digest("hex");
    if (query.cursor && query.cursor.selector !== selector) throw new BadRequestException("appointment_cursor_scope_mismatch");
    return this.prisma.$transaction(async tx => {
      await assertServiceAdministration(tx, actor);
      const timestamp = await asOf(tx);
      const base: Prisma.ServiceAppointmentWhereInput = { merchantId: actor.merchantId, startsAt: { gte: query.from, lt: query.to },
        ...(query.professionalId ? { professionalId: query.professionalId } : {}), ...(query.productId ? { productId: query.productId } : {}),
        ...(query.status ? { operationalStatus: query.status } : {}), ...(query.categoryId ? { product: { merchantId: actor.merchantId, categoryId: query.categoryId } } : {}) };
      if (query.cursor && !await tx.serviceAppointment.findFirst({ where: { AND: [base, { id: query.cursor.id, startsAt: query.cursor.startsAt }] }, select: { id: true } }))
        throw new BadRequestException("appointment_cursor_invalid");
      const totalCount = await tx.serviceAppointment.count({ where: base });
      const grouped = await tx.serviceAppointment.groupBy({ by: ["operationalStatus"], where: base, _count: { _all: true } });
      const countsByStatus: ServiceAppointmentAdminList["countsByStatus"] = { pending: 0, scheduled: 0, in_service: 0, completed: 0, no_show: 0, cancelled: 0 };
      for (const group of grouped) countsByStatus[group.operationalStatus] = group._count._all;
      const rows = await tx.serviceAppointment.findMany({ where: { AND: [base, ...(query.cursor ? [{ OR: [
        { startsAt: { gt: query.cursor.startsAt } }, { startsAt: query.cursor.startsAt, id: { gt: query.cursor.id } },
      ] }] : [])] }, select: selection, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: query.limit + 1 });
      const page = rows.slice(0, query.limit), last = page.at(-1);
      return { items: page.map(project), nextCursor: rows.length > query.limit && last
        ? Buffer.from(JSON.stringify([selector, last.startsAt.toISOString(), last.id])).toString("base64url") : null,
        totalCount, countsByStatus, asOf: timestamp, timeZone };
    }, { isolationLevel: "RepeatableRead" });
  }
  async detail(actor: ServiceActor, appointmentId: string): Promise<ServiceAppointmentAdminDetail> {
    actor = { ...actor };
    if (!id(appointmentId)) throw new BadRequestException("appointment_id_invalid");
    return this.prisma.$transaction(async tx => {
      await assertServiceAdministration(tx, actor);
      const timestamp = await asOf(tx);
      const appointment = await tx.serviceAppointment.findFirst({ where: { merchantId: actor.merchantId, id: appointmentId }, select: selection });
      if (!appointment) throw new NotFoundException("service_appointment_not_found");
      const history = await tx.appointmentAudit.findMany({ where: { merchantId: actor.merchantId, appointmentId },
        select: { id: true, action: true, actorId: true, origin: true, version: true, occurredAt: true },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 101 });
      return { ...project(appointment), history: history.slice(0, 100).map(value => ({ id: value.id, action: value.action, actorId: value.actorId,
        origin: value.origin, version: value.version, occurredAt: value.occurredAt.toISOString() })), historyPartial: history.length > 100, asOf: timestamp };
    }, { isolationLevel: "RepeatableRead" });
  }
}
