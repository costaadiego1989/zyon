import { Inject, Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type {
  ReserveVoiceSessionInput,
  ReserveVoiceSessionResult,
  VoiceSessionQuotaRepository,
  VoiceSessionReservation,
} from "../domain/ports/voice-session-quota.repository.port.js";

class VoiceQuotaLimitReached extends Error {}

@Injectable()
export class PrismaVoiceSessionQuotaRepository implements VoiceSessionQuotaRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async reserve(input: ReserveVoiceSessionInput): Promise<ReserveVoiceSessionResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (transaction) => this.reserveInTransaction(transaction, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (error instanceof VoiceQuotaLimitReached) {
          return { status: "limit_exceeded", used: input.limit };
        }
        if (isSerializationConflict(error) && attempt < 2) continue;
        if (isUniqueConstraint(error)) return this.readIdempotentResult(input);
        throw error;
      }
    }
    throw new Error("voice_session_quota_reservation_retry_exhausted");
  }

  async markProviderCallCreated(sessionId: string): Promise<void> {
    await this.prisma.merchantVoiceSession.updateMany({
      where: { id: sessionId, state: "reserved" },
      data: { state: "created", providerCreatedAt: new Date() },
    });
  }

  async markProviderCallUnknown(sessionId: string): Promise<void> {
    await this.prisma.merchantVoiceSession.updateMany({
      where: { id: sessionId, state: "reserved" },
      data: { state: "reconciliation_required" },
    });
  }

  async releaseBeforeProviderCall(sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.merchantVoiceSession.findUnique({
        where: { id: sessionId },
        select: { id: true, merchantId: true, periodStart: true, state: true },
      });
      if (!session || session.state !== "reserved") return;

      const released = await transaction.merchantVoiceSession.updateMany({
        where: { id: session.id, state: "reserved" },
        data: { state: "released", releasedAt: new Date() },
      });
      if (released.count !== 1) return;

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "merchant_voice_session_quota_periods"
        SET "used_sessions" = GREATEST("used_sessions" - 1, 0),
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "merchant_id" = ${session.merchantId}
          AND "period_start" = ${session.periodStart}
      `);
    });
  }

  private async reserveInTransaction(
    transaction: Prisma.TransactionClient,
    input: ReserveVoiceSessionInput,
  ): Promise<ReserveVoiceSessionResult> {
    const existing = await transaction.merchantVoiceSession.findUnique({
      where: { merchantId_idempotencyKey: { merchantId: input.merchantId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return existingResult(existing, input.requestFingerprint);

    await transaction.merchantVoiceSessionQuotaPeriod.upsert({
      where: { merchantId_periodStart: { merchantId: input.merchantId, periodStart: input.period.start } },
      create: {
        merchantId: input.merchantId,
        periodStart: input.period.start,
        periodEnd: input.period.end,
      },
      update: {},
    });

    await transaction.merchantVoiceSession.create({
      data: {
        merchantId: input.merchantId,
        periodStart: input.period.start,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
      },
    });
    const incremented = await transaction.$executeRaw(Prisma.sql`
      UPDATE "merchant_voice_session_quota_periods"
      SET "used_sessions" = "used_sessions" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "merchant_id" = ${input.merchantId}
        AND "period_start" = ${input.period.start}
        AND "used_sessions" < ${input.limit}
    `);
    if (incremented !== 1) throw new VoiceQuotaLimitReached();

    const reservation = await transaction.merchantVoiceSession.findUniqueOrThrow({
      where: { merchantId_idempotencyKey: { merchantId: input.merchantId, idempotencyKey: input.idempotencyKey } },
    });
    return { status: "reserved", reservation: toReservation(reservation) };
  }

  private async readIdempotentResult(input: ReserveVoiceSessionInput): Promise<ReserveVoiceSessionResult> {
    const existing = await this.prisma.merchantVoiceSession.findUnique({
      where: { merchantId_idempotencyKey: { merchantId: input.merchantId, idempotencyKey: input.idempotencyKey } },
    });
    if (!existing) throw new Error("voice_session_idempotency_lookup_failed");
    return existingResult(existing, input.requestFingerprint);
  }
}

function existingResult(
  session: { id: string; merchantId: string; periodStart: Date; idempotencyKey: string; requestFingerprint: string; state: string },
  requestFingerprint: string,
): ReserveVoiceSessionResult {
  if (session.requestFingerprint !== requestFingerprint) return { status: "idempotency_conflict" };
  return { status: "already_reserved", reservation: toReservation(session) };
}

function toReservation(session: {
  id: string;
  merchantId: string;
  periodStart: Date;
  idempotencyKey: string;
  requestFingerprint: string;
  state: string;
}): VoiceSessionReservation {
  if (!isVoiceSessionState(session.state)) throw new Error("voice_session_state_invalid");
  return {
    id: session.id,
    merchantId: session.merchantId,
    periodStart: session.periodStart,
    idempotencyKey: session.idempotencyKey,
    requestFingerprint: session.requestFingerprint,
    state: session.state,
  };
}

function isVoiceSessionState(value: string): value is VoiceSessionReservation["state"] {
  return value === "reserved" || value === "created" || value === "reconciliation_required" || value === "released";
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
