import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { readProfessionalServiceLink } from "../domain/services/professional-service-link.js";
import { resolveNewProfessionalAvailability, resolveProfessionalAvailability, validateAvailabilityWindow, type ProfessionalAvailabilityQuery } from "../domain/services/professional-availability.js";
import { continuationAvailabilityTimeZone, type ProfessionalAvailabilityContinuation } from "./professional-availability-continuation.js";

export interface ProfessionalAvailabilityReadInput extends ProfessionalAvailabilityQuery { merchantId: string; productId: string; variantId: string; professionalId: string }
/** Private command context, never mapped from public availability input. */
interface OwnAppointmentContext { excludeAppointment?: { appointmentId: string; expectedVersion: number };
  continuation?: ProfessionalAvailabilityContinuation }

/** Shared by HTTP, storefront, WhatsApp and final admission. Callers retain
 * their transaction and server clock. Database errors remain errors. */
export async function getProfessionalAvailability(tx: Prisma.TransactionClient, input: ProfessionalAvailabilityReadInput, context: OwnAppointmentContext = {}) {
  validateAvailabilityWindow(input);
  const exclusion = context.excludeAppointment;
  if (exclusion) {
    if (typeof exclusion.appointmentId !== "string" || !exclusion.appointmentId || !Number.isSafeInteger(exclusion.expectedVersion) || exclusion.expectedVersion < 1)
      throw new ConflictException("service_appointment_exclusion_conflict");
    const own = await tx.serviceAppointment.findFirst({ where: { id: exclusion.appointmentId, merchantId: input.merchantId,
      version: exclusion.expectedVersion, productId: input.productId, variantId: input.variantId,
      operationalStatus: { in: ["pending", "scheduled"] } }, select: { id: true } });
    if (!own || own.id !== exclusion.appointmentId) throw new ConflictException("service_appointment_exclusion_conflict");
  }
  const link = await readProfessionalServiceLink(tx, input);
  const policy = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: input.merchantId }, select: { version: true, configuredAt: true } });
  const policyVersion = policy?.configuredAt ? policy.version : null;
  const preservedTimeZone = continuationAvailabilityTimeZone(context.continuation, input, { ...link, policyVersion });
  const resolve = (source: Parameters<typeof resolveProfessionalAvailability>[0]) => preservedTimeZone === undefined
    ? resolveNewProfessionalAvailability(source, input) : resolveProfessionalAvailability({ ...source, timeZone: preservedTimeZone }, input);
  if (input.expectedVersion !== undefined && input.expectedVersion !== link.professionalVersion) return resolve({ ...link, policyVersion, recurring: [], exceptions: [], appointments: [] });
  // Pad UTC boundaries for all supported IANA offsets; actual date selection
  // and duration run once in the canonical resolver.
  const lower = new Date(Date.parse(input.fromDate + "T00:00:00Z") - 86_400_000), upper = new Date(Date.parse(input.toDate + "T00:00:00Z") + 2 * 86_400_000);
  const [recurring, exceptions, appointments] = await Promise.all([
    tx.professionalAvailability.findMany({ where: { merchantId: input.merchantId, professionalId: input.professionalId, isActive: true, AND: [ { OR: [{ validFrom: null }, { validFrom: { lt: upper } }] }, { OR: [{ validUntil: null }, { validUntil: { gt: lower } }] } ] }, take: 101 }),
    tx.availabilityException.findMany({ where: { merchantId: input.merchantId, professionalId: input.professionalId, isActive: true, startsAt: { lt: upper }, endsAt: { gt: lower } }, take: 5001 }),
    tx.serviceAppointment.findMany({ where: { merchantId: input.merchantId, professionalId: input.professionalId, operationalStatus: { in: ["scheduled", "in_service", "completed", "no_show"] }, startsAt: { lt: upper }, endsAt: { gt: lower }, ...(exclusion ? { NOT: { id: exclusion.appointmentId } } : {}) }, select: { startsAt: true, endsAt: true }, take: 10001 }),
  ]);
  if (recurring.length > 100 || exceptions.length > 5000 || appointments.length > 10000) throw new ServiceUnavailableException("availability_source_limit");
  return resolve({ ...link, policyVersion, recurring, exceptions, appointments });
}
