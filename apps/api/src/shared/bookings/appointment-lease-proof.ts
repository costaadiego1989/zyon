import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { slotFingerprint, type SlotRequest } from "./redis-service-slots.js";

type Target = { resourceId: string; slotId: string; startsAt: string; endsAt: string };
export type OwnedAppointmentLease = { schemaVersion: 1; kind: "owned"; merchantId: string; ownerHash: string;
  generation: string; fingerprint: string; targetKey: string; target: Target; resources: string[]; expiresAt: string };
export type NoAppointmentLease = { schemaVersion: 1; kind: "none"; reason: "hold_off" | "pending_without_lease"; targetKey: string; target: Target };
export type AppointmentLeaseCapture = OwnedAppointmentLease | NoAppointmentLease;
type JsonRecord = { [key: string]: Prisma.InputJsonValue | null | undefined };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v && v.trim() === v && v.length <= 191;
const resource = (v: unknown): v is string => typeof v === "string" && !!v && v.trim() === v && v.length <= 256;
const hex = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const key = (v: Target) => hash(JSON.stringify([v.resourceId, v.slotId, v.startsAt, v.endsAt]));
const same = (a: Target, b: Target) => a.resourceId === b.resourceId && a.slotId === b.slotId && a.startsAt === b.startsAt && a.endsAt === b.endsAt;
function target(v: unknown): Target | undefined {
  if (!object(v) || !resource(v.resourceId) || !id(v.slotId) || typeof v.startsAt !== "string" || typeof v.endsAt !== "string"
    || !Number.isFinite(Date.parse(v.startsAt)) || !Number.isFinite(Date.parse(v.endsAt)) || Date.parse(v.startsAt) >= Date.parse(v.endsAt)) return;
  return { resourceId: v.resourceId, slotId: v.slotId, startsAt: v.startsAt, endsAt: v.endsAt };
}
export function noAppointmentLease(value: SlotRequest, reason: NoAppointmentLease["reason"]): NoAppointmentLease {
  const own = target(value); if (!own) throw new ConflictException("service_hold_original_proof_required");
  return { schemaVersion: 1, kind: "none", reason, targetKey: key(own), target: own };
}
/** Original Redis proof only, obtained while final admission still owns its locks.
 * Never accept an owner, generation or proof from HTTP, today's cart or a clock. */
export function captureAppointmentLease(merchantId: string, ownerId: string, proof: unknown, value: SlotRequest): OwnedAppointmentLease {
  const own = target(value);
  if (!id(merchantId) || !id(ownerId) || !own || !object(proof) || proof.merchantId !== merchantId
    || proof.ownerHash !== hash(ownerId) || !uuid(proof.generation) || !hex(proof.fingerprint)
    || typeof proof.expiresAt !== "string" || !Number.isFinite(Date.parse(proof.expiresAt)) || !Array.isArray(proof.slots))
    throw new ConflictException("service_hold_original_proof_required");
  const slots = proof.slots.map(target);
  if (!slots.length || slots.some(v => !v) || slotFingerprint(slots as Target[]) !== (proof.selectionFingerprint ?? proof.fingerprint)
    || !slots.some(v => v && same(v, own))) throw new ConflictException("service_hold_original_proof_required");
  return { schemaVersion: 1, kind: "owned", merchantId, ownerHash: proof.ownerHash, generation: proof.generation,
    fingerprint: proof.fingerprint, targetKey: key(own), target: own,
    resources: [...new Set((slots as Target[]).map(v => v.resourceId))].sort(), expiresAt: proof.expiresAt };
}
export function parseAppointmentLease(v: unknown): AppointmentLeaseCapture | undefined {
  if (!object(v) || v.schemaVersion !== 1) return;
  const own = target(v.target); if (!own || v.targetKey !== key(own)) return;
  if (v.kind === "none" && ["hold_off", "pending_without_lease"].includes(String(v.reason)))
    return { schemaVersion: 1, kind: "none", reason: v.reason as NoAppointmentLease["reason"], targetKey: key(own), target: own };
  if (v.kind !== "owned" || !id(v.merchantId) || !hex(v.ownerHash) || !uuid(v.generation) || !hex(v.fingerprint)
    || typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt)) || !Array.isArray(v.resources)
    || !v.resources.length || !v.resources.every(resource) || new Set(v.resources).size !== v.resources.length || !v.resources.includes(own.resourceId)) return;
  return { schemaVersion: 1, kind: "owned", merchantId: v.merchantId, ownerHash: v.ownerHash, generation: v.generation,
    fingerprint: v.fingerprint, targetKey: key(own), target: own, resources: [...v.resources] as string[], expiresAt: v.expiresAt };
}
/** Original capture is immutable even when admission is renamed by30/31/35. */
export function retainAppointmentLease<T extends JsonRecord>(after: unknown, next: T): T & { privateLease?: AppointmentLeaseCapture } {
  if (!object(after) || !Object.hasOwn(after, "privateLease")) return next;
  const capture = parseAppointmentLease(after.privateLease);
  if (!capture) throw new ConflictException("service_hold_original_proof_required");
  return { ...next, privateLease: capture };
}
export async function assertLeaseCaptureUnusedWithin(tx: Prisma.TransactionClient, merchantId: string, capture: AppointmentLeaseCapture) {
  if (capture.kind !== "owned") return;
  if (capture.merchantId !== merchantId) throw new ConflictException("service_hold_original_proof_required");
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM appointment_audits
    WHERE merchant_id = ${merchantId} AND "after"->'privateLease'->>'kind' = 'owned'
      AND "after"->'privateLease'->>'generation' = ${capture.generation}
      AND "after"->'privateLease'->>'targetKey' = ${capture.targetKey} LIMIT 1`;
  if (rows.length) throw new ConflictException("service_hold_generation_consumed");
}
/** Future34 must write its NEW binding at its own version, including kind:none.
 * Read the latest capture once; a moved/mismatched target never falls back. */
export async function findAppointmentLeaseWithin(tx: Prisma.TransactionClient, appointment: {
  id: string; merchantId: string; professionalId: string; startsAt: Date; endsAt: Date; version: number;
}) {
  const audit = await tx.appointmentAudit.findFirst({ where: { merchantId: appointment.merchantId,
    appointmentId: appointment.id, version: { lte: appointment.version },
    after: { path: ["privateLease", "schemaVersion"], equals: 1 } },
  orderBy: [{ version: "desc" }, { occurredAt: "desc" }, { id: "desc" }], select: { id: true, version: true, after: true } });
  if (!audit) return;
  const capture = parseAppointmentLease(object(audit.after) ? audit.after.privateLease : undefined);
  if (!capture || capture.target.resourceId !== "professional:" + appointment.professionalId
    || Date.parse(capture.target.startsAt) !== appointment.startsAt.getTime() || Date.parse(capture.target.endsAt) !== appointment.endsAt.getTime()
    || capture.kind === "owned" && capture.merchantId !== appointment.merchantId)
    throw new ConflictException("service_appointment_lease_binding_mismatch");
  return { auditId: audit.id, capture };
}
