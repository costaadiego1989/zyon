import type {
  CreatePlatformSupportTicket, PlatformSupportCapabilities, PlatformSupportCategory,
  PlatformSupportConversation, PlatformSupportMessage, PlatformSupportNote, PlatformSupportPage,
  PlatformSupportQuery, PlatformSupportSeverity, PlatformSupportStatus, SendPlatformSupportMessage,
} from "@zyon/shared-types";

export type SupportActor =
  | { kind: "merchant"; id: string; merchantId: string }
  | { kind: "operator"; id: string; canAssign: boolean };

export const actorKey = (actor: SupportActor) => `${actor.kind}:${actor.id}`;
export const SUPPORT_REPOSITORY = Symbol("PLATFORM_SUPPORT_REPOSITORY");

export class SupportError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

export interface SupportTreatment {
  status?: PlatformSupportStatus;
  severity?: PlatformSupportSeverity;
  assignedOperatorId?: string | null;
}

export interface PlatformSupportRepository {
  plan(merchantId: string): Promise<import("@zyon/shared-types").BillingPlan>;
  create(actor: Extract<SupportActor, { kind: "merchant" }>, input: CreatePlatformSupportTicket): Promise<PlatformSupportConversation>;
  list(actor: SupportActor, query: PlatformSupportQuery, agingHours: number): Promise<PlatformSupportPage>;
  conversation(actor: SupportActor, ticketId: string, before?: number): Promise<PlatformSupportConversation>;
  send(actor: SupportActor, ticketId: string, input: SendPlatformSupportMessage): Promise<PlatformSupportMessage>;
  read(actor: SupportActor, ticketId: string, sequence: number): Promise<void>;
  reopen(actor: SupportActor, ticketId: string): Promise<void>;
  treat(actor: Extract<SupportActor, { kind: "operator" }>, ticketId: string, input: SupportTreatment): Promise<void>;
  notes(actor: Extract<SupportActor, { kind: "operator" }>, ticketId: string): Promise<PlatformSupportNote[]>;
  addNote(actor: Extract<SupportActor, { kind: "operator" }>, ticketId: string, content: string, clientRequestId: string): Promise<void>;
  auditRead(actor: Extract<SupportActor, { kind: "operator" }>, ticketId?: string): Promise<void>;
}

export function supportText(value: unknown, min: number, max: number, field: string): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new SupportError(`support_invalid_${field}`);
  }
  return value.trim();
}

export function supportId(value: unknown): string {
  const id = supportText(value, 1, 100, "id");
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new SupportError("support_invalid_id");
  return id;
}

export function supportCategory(value: unknown): PlatformSupportCategory {
  if (!["bug", "improvement", "suggestion", "other"].includes(value as string)) throw new SupportError("support_invalid_category");
  return value as PlatformSupportCategory;
}

export function supportStatus(value: unknown): PlatformSupportStatus {
  if (!["open", "in_progress", "waiting_customer", "resolved"].includes(value as string)) throw new SupportError("support_invalid_status");
  return value as PlatformSupportStatus;
}

