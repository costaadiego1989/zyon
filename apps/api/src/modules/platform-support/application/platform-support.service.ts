import { Inject, Injectable } from "@nestjs/common";
import { BILLING_PLANS } from "../../payment/domain/billing-plans.js";
import { SUPPORT_REPOSITORY, SupportError, supportCategory, supportId, supportStatus, supportText, type PlatformSupportRepository, type SupportActor, type SupportTreatment } from "../domain/platform-support.js";
import { PlatformSupportRateLimiter } from "../infrastructure/platform-support-rate-limiter.js";

@Injectable()
export class PlatformSupportService {
  readonly agingHours = positiveHours(process.env.PLATFORM_SUPPORT_AGING_HOURS);

  constructor(
    @Inject(SUPPORT_REPOSITORY) private readonly repository: PlatformSupportRepository,
    @Inject(PlatformSupportRateLimiter) private readonly rate: PlatformSupportRateLimiter,
  ) {}

  async capabilities(merchantId: string) {
    const plan = await this.repository.plan(merchantId);
    return { plan, canOpen: BILLING_PLANS[plan].features.realtimeChatSupport, tier: BILLING_PLANS[plan].features.prioritySupport ? "priority" as const : "standard" as const, availability: process.env.PLATFORM_SUPPORT_HOURS_TEXT?.trim() || "Respostas conforme disponibilidade da equipe técnica.", agingHours: this.agingHours };
  }

  async create(actor: SupportActor, data: { subject?: unknown; category?: unknown; content?: unknown; clientRequestId?: unknown }) {
    if (actor.kind !== "merchant") throw new SupportError("support_merchant_required", 403);
    const input = { subject: supportText(data.subject, 5, 160, "subject"), category: supportCategory(data.category), content: supportText(data.content, 10, 4000, "content"), clientRequestId: supportId(data.clientRequestId) };
    if (!(await this.capabilities(actor.merchantId)).canOpen) throw new SupportError("support_plan_required", 403);
    await this.rate.check(`create:${actor.id}`, 10, 3_600_000);
    return this.repository.create(actor, input);
  }

  async list(actor: SupportActor, query: { status?: unknown; search?: unknown; mine?: unknown; cursor?: unknown }) {
    if (actor.kind === "operator") await this.repository.auditRead(actor);
    return this.repository.list(actor, {
      ...(query.status ? { status: supportStatus(query.status) } : {}),
      ...(query.search ? { search: supportText(query.search, 1, 160, "search") } : {}),
      ...(query.cursor ? { cursor: supportId(query.cursor) } : {}),
      mine: query.mine === true || query.mine === "true",
    }, this.agingHours);
  }

  async conversation(actor: SupportActor, id: unknown, before?: unknown) {
    const ticketId = supportId(id);
    if (actor.kind === "operator") await this.repository.auditRead(actor, ticketId);
    const sequence = before === undefined ? undefined : Number(before);
    if (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence < 1)) throw new SupportError("support_invalid_sequence");
    return this.repository.conversation(actor, ticketId, sequence);
  }

  async send(actor: SupportActor, id: unknown, data: { content?: unknown; clientMessageId?: unknown }) {
    const ticketId = supportId(id);
    const input = { content: supportText(data.content, 1, 4000, "content"), clientMessageId: supportId(data.clientMessageId) };
    await this.rate.check(`message:${actor.kind}:${actor.id}`, 30, 60_000);
    // Existing unresolved conversations remain available after a downgrade.
    return this.repository.send(actor, ticketId, input);
  }

  async read(actor: SupportActor, id: unknown, sequence: unknown) {
    if (!Number.isSafeInteger(sequence) || (sequence as number) < 0) throw new SupportError("support_invalid_sequence");
    await this.repository.read(actor, supportId(id), sequence as number);
    return { success: true };
  }

  async treat(actor: SupportActor, id: unknown, data: { status?: unknown; severity?: unknown; assignedOperatorId?: unknown }) {
    if (actor.kind !== "operator") throw new SupportError("support_operator_required", 403);
    const input: SupportTreatment = {};
    if (data.status !== undefined) input.status = supportStatus(data.status);
    if (data.severity !== undefined) {
      if (!["normal", "high", "critical"].includes(data.severity as string)) throw new SupportError("support_invalid_severity");
      input.severity = data.severity as SupportTreatment["severity"];
    }
    if (data.assignedOperatorId !== undefined) input.assignedOperatorId = data.assignedOperatorId === null ? null : supportId(data.assignedOperatorId);
    if (!Object.keys(input).length) throw new SupportError("support_empty_treatment");
    await this.repository.treat(actor, supportId(id), input);
    return this.conversation(actor, id);
  }

  async reopen(actor: SupportActor, id: unknown) {
    if (actor.kind === "merchant" && !(await this.capabilities(actor.merchantId)).canOpen) throw new SupportError("support_plan_required", 403);
    await this.rate.check(`reopen:${actor.kind}:${actor.id}`, 10, 60_000);
    await this.repository.reopen(actor, supportId(id));
    return this.conversation(actor, id);
  }

  async notes(actor: SupportActor, id: unknown) {
    if (actor.kind !== "operator") throw new SupportError("support_operator_required", 403);
    await this.repository.auditRead(actor, supportId(id));
    return this.repository.notes(actor, supportId(id));
  }

  async addNote(actor: SupportActor, id: unknown, data: { content?: unknown; clientRequestId?: unknown }) {
    if (actor.kind !== "operator") throw new SupportError("support_operator_required", 403);
    await this.rate.check(`note:${actor.id}`, 30, 60_000);
    await this.repository.addNote(actor, supportId(id), supportText(data.content, 1, 4000, "content"), supportId(data.clientRequestId));
    return this.notes(actor, id);
  }
}

function positiveHours(raw: string | undefined) {
  const hours = Number(raw ?? 24);
  return Number.isFinite(hours) && hours >= 1 && hours <= 168 ? hours : 24;
}
