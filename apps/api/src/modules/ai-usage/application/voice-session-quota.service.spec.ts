import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { VoiceSessionQuotaService } from "./voice-session-quota.service.js";
import type {
  VoiceSessionQuotaRepository,
  VoiceSessionReservation,
} from "../domain/ports/voice-session-quota.repository.port.js";

class MemoryVoiceSessionQuotaRepository implements VoiceSessionQuotaRepository {
  readonly reservations: VoiceSessionReservation[] = [];

  async reserve(input: Parameters<VoiceSessionQuotaRepository["reserve"]>[0]) {
    const existing = this.reservations.find((item) =>
      item.merchantId === input.merchantId && item.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) return { status: "idempotency_conflict" } as const;
      return { status: "already_reserved", reservation: existing } as const;
    }
    const used = this.reservations.filter((item) =>
      item.merchantId === input.merchantId && item.periodStart.getTime() === input.period.start.getTime() && item.state !== "released",
    ).length;
    if (used >= input.limit) return { status: "limit_exceeded", used } as const;

    const reservation: VoiceSessionReservation = {
      id: `voice_${this.reservations.length + 1}`,
      merchantId: input.merchantId,
      periodStart: input.period.start,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      state: "reserved",
    };
    this.reservations.push(reservation);
    return { status: "reserved", reservation } as const;
  }

  async markProviderCallCreated(sessionId: string): Promise<void> {
    this.setState(sessionId, "created");
  }

  async markProviderCallUnknown(sessionId: string): Promise<void> {
    this.setState(sessionId, "reconciliation_required");
  }

  async releaseBeforeProviderCall(sessionId: string): Promise<void> {
    this.setState(sessionId, "released");
  }

  private setState(sessionId: string, state: VoiceSessionReservation["state"]): void {
    const reservation = this.reservations.find((item) => item.id === sessionId);
    if (reservation) reservation.state = state;
  }
}

function service(plan: "starter" | "growth" | "scale", repository = new MemoryVoiceSessionQuotaRepository(), accountFor = (merchantId: string) => merchantId) {
  const billing = {
    assertAllowed: async () => undefined,
    getEffectivePlan: async () => plan,
    resolveBillingAccountMerchantId: async (merchantId: string) => accountFor(merchantId),
  };
  return { repository, service: new VoiceSessionQuotaService(repository, billing as never, () => new Date("2026-09-20T12:00:00.000Z")) };
}

test("Growth admits exactly 100 voice sessions in the UTC month", async () => {
  const { service: quota } = service("growth");
  for (let index = 0; index < 100; index += 1) {
    const reservation = await quota.reserve({ merchantId: "merchant_growth", idempotencyKey: `attempt_${index}`, requestFingerprint: `fingerprint_${index}` });
    assert.equal(reservation.id, `voice_${index + 1}`);
  }
  await assert.rejects(
    () => quota.reserve({ merchantId: "merchant_growth", idempotencyKey: "attempt_100", requestFingerprint: "fingerprint_100" }),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code?: string }).code === "voice_session_limit_exceeded",
  );
});

test("Scale admits exactly 300 voice sessions and never inherits Growth usage", async () => {
  const repository = new MemoryVoiceSessionQuotaRepository();
  const growth = service("growth", repository).service;
  const scale = service("scale", repository).service;
  for (let index = 0; index < 100; index += 1) {
    await growth.reserve({ merchantId: "merchant_growth", idempotencyKey: `growth_${index}`, requestFingerprint: `growth_${index}` });
  }
  for (let index = 0; index < 300; index += 1) {
    await scale.reserve({ merchantId: "merchant_scale", idempotencyKey: `scale_${index}`, requestFingerprint: `scale_${index}` });
  }
  await assert.rejects(
    () => scale.reserve({ merchantId: "merchant_scale", idempotencyKey: "scale_300", requestFingerprint: "scale_300" }),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { limit?: number }).limit === 300,
  );
});

test("a repeated attempt does not consume a second session and changed content is rejected", async () => {
  const { service: quota, repository } = service("growth");
  const first = await quota.reserve({ merchantId: "merchant_growth", idempotencyKey: "retry_1", requestFingerprint: "first" });
  const repeated = await quota.reserve({ merchantId: "merchant_growth", idempotencyKey: "retry_1", requestFingerprint: "first" });
  assert.equal(repeated.id, first.id);
  assert.equal(repository.reservations.length, 1);
  await assert.rejects(
    () => quota.reserve({ merchantId: "merchant_growth", idempotencyKey: "retry_1", requestFingerprint: "changed" }),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code?: string }).code === "voice_session_idempotency_conflict",
  );
});

test("only failures known to occur before provider creation release the reserved session", async () => {
  const { service: quota, repository } = service("growth");
  const released = await quota.reserve({ merchantId: "merchant_growth", idempotencyKey: "released", requestFingerprint: "released" });
  await quota.releaseBeforeProviderCall(released.id);
  assert.equal(repository.reservations[0]?.state, "released");
  const replacement = await quota.reserve({ merchantId: "merchant_growth", idempotencyKey: "replacement", requestFingerprint: "replacement" });
  await quota.markProviderCallUnknown(replacement.id);
  assert.equal(repository.reservations[1]?.state, "reconciliation_required");
});


test("Scale stores share one voice quota through their billing account", async () => {
  const repository = new MemoryVoiceSessionQuotaRepository();
  const quota = service("scale", repository, () => "billing_account").service;
  for (let index = 0; index < 300; index += 1) {
    await quota.reserve({ merchantId: index % 2 === 0 ? "store_a" : "store_b", idempotencyKey: `attempt_${index}`, requestFingerprint: `fingerprint_${index}` });
  }
  await assert.rejects(
    () => quota.reserve({ merchantId: "store_a", idempotencyKey: "attempt_300", requestFingerprint: "fingerprint_300" }),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { limit?: number }).limit === 300,
  );
});
