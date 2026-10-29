import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import {
  isPlatformFeedbackPriority,
  isPlatformFeedbackStatus,
  type PlatformFeedback,
  type PlatformFeedbackStatus,
} from "../domain/platform-feedback.js";
import type {
  ChangePlatformFeedbackTreatment,
  PlatformFeedbackReadAudit,
  PlatformFeedbackPage,
  PlatformFeedbackQuery,
  PlatformFeedbackRepository,
} from "../domain/ports/platform-feedback-repository.port.js";

@Injectable()
export class PrismaPlatformFeedbackRepository implements PlatformFeedbackRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(input: PlatformFeedbackQuery): Promise<PlatformFeedbackPage> {
    const rows = await this.prisma.merchantPlatformFeedback.findMany({
      where: feedbackWhere(input.status, input.category),
      include: treatmentInclude(),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items: await this.present(page),
      ...(hasMore ? { nextCursor: page[page.length - 1]?.id } : {}),
    };
  }

  async findById(id: string): Promise<PlatformFeedback | undefined> {
    const [row, auditHistory] = await Promise.all([
      this.prisma.merchantPlatformFeedback.findUnique({
        where: { id },
        include: treatmentDetailInclude(),
      }),
      this.prisma.platformAuditEvent.findMany({
        where: {
          action: "feedback.treatment.changed",
          targetType: "merchant_platform_feedback",
          targetId: id,
        },
        select: {
          id: true,
          actorOperatorId: true,
          createdAt: true,
          details: true,
          actor: { select: { email: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
    ]);
    if (!row) return undefined;
    return (await this.present([row], auditHistory))[0];
  }

  async recordRead(input: PlatformFeedbackReadAudit): Promise<void> {
    await this.prisma.platformAuditEvent.create({
      data: {
        actorOperatorId: input.actorOperatorId,
        action: input.action,
        permission: "platform:feedback:read",
        environment: input.environment,
        targetType: input.targetType,
        ...(input.targetId ? { targetId: input.targetId } : {}),
        correlationId: input.correlationId,
        outcome: "succeeded",
        ...(input.details ? { details: input.details } : {}),
      },
    });
  }

  async changeTreatment(input: ChangePlatformFeedbackTreatment): Promise<PlatformFeedback> {
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      const feedback = await tx.merchantPlatformFeedback.findUnique({ where: { id: input.feedbackId } });
      if (!feedback) throw new Error("platform_feedback_not_found");
      if (input.assignedOperatorId) await assertActiveOperator(tx, input.assignedOperatorId);

      const existing = await tx.platformFeedbackTreatment.findUnique({ where: { feedbackId: input.feedbackId } });
      const status = input.status ?? existing?.status ?? "new";
      const priority = input.priority ?? existing?.priority ?? "normal";
      const assignedOperatorId = input.assignedOperatorId === undefined
        ? existing?.assignedOperatorId ?? null
        : input.assignedOperatorId;
      const firstReadAt = existing?.firstReadAt ?? (status === "new" ? null : now);
      const resolvedAt = closedStatus(status)
        ? existing?.resolvedAt ?? now
        : null;

      await tx.platformFeedbackTreatment.upsert({
        where: { feedbackId: input.feedbackId },
        create: {
          feedbackId: input.feedbackId,
          status,
          priority,
          assignedOperatorId,
          firstReadAt,
          resolvedAt,
        },
        update: {
          status,
          priority,
          assignedOperatorId,
          firstReadAt,
          resolvedAt,
        },
      });
      if (input.note) {
        await tx.platformFeedbackNote.create({
          data: { feedbackId: input.feedbackId, operatorId: input.actorOperatorId, message: input.note },
        });
      }
      await tx.platformAuditEvent.create({
        data: {
          actorOperatorId: input.actorOperatorId,
          action: "feedback.treatment.changed",
          permission: "platform:feedback:write",
          environment: input.environment,
          targetType: "merchant_platform_feedback",
          targetId: input.feedbackId,
          correlationId: input.correlationId,
          outcome: "succeeded",
          details: {
            previousStatus: existing?.status ?? "new",
            status,
            previousPriority: existing?.priority ?? "normal",
            priority,
            previousAssignedOperatorId: existing?.assignedOperatorId ?? null,
            assignedOperatorId,
            noteAdded: Boolean(input.note),
          },
        },
      });
    });
    const result = await this.findById(input.feedbackId);
    if (!result) throw new Error("platform_feedback_not_found");
    return result;
  }

  private async present(rows: Array<FeedbackRow>, auditHistory: FeedbackAuditRow[] = []): Promise<PlatformFeedback[]> {
    const merchantIds = unique(rows.map(row => row.merchantId));
    const authorIds = unique(rows.map(row => row.userId));
    const [merchants, authors] = await Promise.all([
      this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, name: true } }),
      this.prisma.merchantUser.findMany({ where: { id: { in: authorIds } }, select: { id: true, email: true } }),
    ]);
    const merchantsById = new Map(merchants.map(merchant => [merchant.id, merchant]));
    const authorsById = new Map(authors.map(author => [author.id, author]));
    const operatorIds = unique([
      ...rows.flatMap(row => [row.treatment?.assignedOperatorId ?? "", ...row.treatment?.notes.map(note => note.operatorId) ?? []]),
      ...auditHistory.flatMap(event => event.actorOperatorId ? [event.actorOperatorId] : []),
    ].filter(Boolean));
    const operators = operatorIds.length === 0
      ? []
      : await this.prisma.platformOperator.findMany({
        where: { id: { in: operatorIds } },
        select: { id: true, email: true },
      });
    const operatorsById = new Map(operators.map(operator => [operator.id, operator]));
    return rows.map(row => presentFeedback(row, merchantsById, authorsById, operatorsById, auditHistory));
  }
}

type FeedbackRow = Awaited<ReturnType<typeof feedbackRow>>;

function feedbackRow() {
  return {
    id: "",
    merchantId: "",
    userId: "",
    category: "",
    message: "",
    createdAt: new Date(),
    treatment: null as null | {
      status: string;
      priority: string;
      assignedOperatorId: string | null;
      firstReadAt: Date | null;
      resolvedAt: Date | null;
      updatedAt: Date;
      notes: Array<{ id: string; operatorId: string; message: string; createdAt: Date }>;
    },
  };
}

function treatmentInclude() {
  return {
    treatment: {
      include: {
        notes: { take: 1, orderBy: { createdAt: "desc" as const } },
      },
    },
  };
}

function treatmentDetailInclude() {
  return {
    treatment: {
      include: {
        notes: { take: 100, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] },
      },
    },
  };
}

function feedbackWhere(status: PlatformFeedbackStatus | undefined, category: string | undefined) {
  return {
    ...(category ? { category } : {}),
    ...(status ? status === "new"
      ? { OR: [{ treatment: { is: null } }, { treatment: { is: { status } } }] }
      : { treatment: { is: { status } } }
      : {}),
  };
}

function presentFeedback(
  row: FeedbackRow,
  merchants: Map<string, { id: string; name: string }>,
  authors: Map<string, { id: string; email: string }>,
  operators: Map<string, { id: string; email: string }>,
  auditHistory: FeedbackAuditRow[],
): PlatformFeedback {
  const treatment = row.treatment;
  const latestNote = treatment?.notes[0];
  return {
    id: row.id,
    merchantId: row.merchantId,
    merchantName: merchants.get(row.merchantId)?.name,
    authorUserId: row.userId,
    authorEmail: authors.get(row.userId)?.email,
    category: row.category,
    message: row.message,
    createdAt: row.createdAt,
    treatment: {
      status: (treatment?.status ?? "new") as PlatformFeedback["treatment"]["status"],
      priority: (treatment?.priority ?? "normal") as PlatformFeedback["treatment"]["priority"],
      assignedOperatorId: treatment?.assignedOperatorId ?? undefined,
      assignedOperatorEmail: treatment?.assignedOperatorId
        ? operators.get(treatment.assignedOperatorId)?.email
        : undefined,
      firstReadAt: treatment?.firstReadAt ?? undefined,
      resolvedAt: treatment?.resolvedAt ?? undefined,
      updatedAt: treatment?.updatedAt ?? undefined,
      latestNote: latestNote ? {
        id: latestNote.id,
        operatorId: latestNote.operatorId,
        operatorEmail: operators.get(latestNote.operatorId)?.email,
        message: latestNote.message,
        createdAt: latestNote.createdAt,
      } : undefined,
      ...(treatment && treatment.notes.length > 1 ? {
        notes: treatment.notes.map(note => ({
          id: note.id,
          operatorId: note.operatorId,
          operatorEmail: operators.get(note.operatorId)?.email,
          message: note.message,
          createdAt: note.createdAt,
        })),
      } : {}),
      ...(auditHistory.length > 0 ? {
        auditHistory: auditHistory.map(event => presentTreatmentAudit(event)),
      } : {}),
    },
  };
}

type FeedbackAuditRow = Prisma.PlatformAuditEventGetPayload<{
  select: {
    id: true;
    actorOperatorId: true;
    createdAt: true;
    details: true;
    actor: { select: { email: true } };
  };
}>;

function presentTreatmentAudit(event: FeedbackAuditRow) {
  const details = isRecord(event.details) ? event.details : {};
  return {
    id: event.id,
    ...(event.actorOperatorId ? { actorOperatorId: event.actorOperatorId } : {}),
    ...(event.actor?.email ? { actorOperatorEmail: event.actor.email } : {}),
    occurredAt: event.createdAt,
    previous: {
      ...statusDetail(details, "previousStatus", "status"),
      ...priorityDetail(details, "previousPriority", "priority"),
      ...assigneeDetail(details, "previousAssignedOperatorId", "assignedOperatorId"),
    },
    current: {
      ...statusDetail(details, "status", "status"),
      ...priorityDetail(details, "priority", "priority"),
      ...assigneeDetail(details, "assignedOperatorId", "assignedOperatorId"),
    },
    noteAdded: details.noteAdded === true,
  };
}

function statusDetail(details: Record<string, Prisma.JsonValue>, key: string, output: string) {
  const value = details[key];
  return typeof value === "string" && isPlatformFeedbackStatus(value) ? { [output]: value } : {};
}

function priorityDetail(details: Record<string, Prisma.JsonValue>, key: string, output: string) {
  const value = details[key];
  return typeof value === "string" && isPlatformFeedbackPriority(value) ? { [output]: value } : {};
}

function assigneeDetail(details: Record<string, Prisma.JsonValue>, key: string, output: string) {
  const value = details[key];
  return value === null || (typeof value === "string" && value.length <= 160)
    ? { [output]: value }
    : {};
}

function isRecord(value: Prisma.JsonValue | null): value is Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function assertActiveOperator(
  prisma: Prisma.TransactionClient,
  operatorId: string,
): Promise<void> {
  const operator = await prisma.platformOperator.findFirst({ where: { id: operatorId, disabledAt: null } });
  if (!operator) throw new Error("platform_feedback_assignee_not_found");
}

function closedStatus(status: string): boolean {
  return status === "resolved" || status === "declined";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
