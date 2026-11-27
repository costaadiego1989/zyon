import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ProspectingActor } from "../../domain/prospecting.ports.js";
import { stableDirectoryJson } from "../../domain/company-directory/directory-values.js";

export function validateCommandId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[-A-Za-z0-9_.:]{1,160}$/.test(value)) throw new Error("invalid_command:clientRequestId");
}
export async function prospectCommand<T, C extends { clientRequestId: string }>(prisma: PrismaClient, kind: string, command: C, actor: ProspectingActor, mutate: (tx: Prisma.TransactionClient) => Promise<{ result: T; resourceIds: string[] }>): Promise<T> {
  validateCommandId(command.clientRequestId);
  const requestHash = createHash("sha256").update(stableDirectoryJson({ kind, command })).digest("hex");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${command.clientRequestId}))::text`;
    const previous = await tx.prospectCommand.findUnique({ where: { clientRequestId: command.clientRequestId } });
    if (previous) {
      if (previous.actorOperatorId !== actor.operatorId || previous.requestHash !== requestHash || previous.kind !== kind) throw new Error("idempotency_conflict");
      return previous.result as T;
    }
    const { result, resourceIds } = await mutate(tx);
    await tx.prospectCommand.create({ data: { clientRequestId: command.clientRequestId, actorOperatorId: actor.operatorId, requestHash, kind, state: "completed", result: JSON.parse(JSON.stringify(result)), resourceIds } });
    return result;
  }, { timeout: 20_000 });
}
export async function prospectAudit(tx: Prisma.TransactionClient, actor: ProspectingActor, action: string, resourceType: string, resourceId: string, resourceVersion: number, details?: Prisma.InputJsonValue) {
  await tx.prospectAuditEvent.create({ data: { actorOperatorId: actor.operatorId, action, resourceType, resourceId, resourceVersion, correlationId: actor.correlationId, outcome: "completed", ...(details === undefined ? {} : { details }) } });
}
