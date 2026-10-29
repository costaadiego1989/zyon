import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { OrderQuotaService } from "./order-quota.service.js";
import type { OrderQuotaRepository, PersistOrderQuotaNotice } from "../../domain/ports/order-quota.repository.port.js";
import type { OrderQuotaEpisode, OrderQuotaPeriod } from "../../domain/services/order-quota.types.js";

class MemoryOrderQuotaRepository implements OrderQuotaRepository {
  private readonly periods = new Map<string, number>();
  private readonly entries = new Set<string>();
  readonly episodes: OrderQuotaEpisode[] = [];
  readonly notices: PersistOrderQuotaNotice[] = [];

  seedPeriod(merchantId: string, periodStart: Date, usedOrders: number): void {
    this.periods.set(key(merchantId, periodStart), usedOrders);
  }

  using(): OrderQuotaRepository { return this; }

  async recordCompletedOrder(input: { merchantId: string; externalOrderId: string; period: OrderQuotaPeriod }): Promise<number> {
    const periodKey = key(input.merchantId, input.period.start);
    const entryKey = `${periodKey}:${input.externalOrderId}`;
    if (!this.entries.has(entryKey)) {
      this.entries.add(entryKey);
      this.periods.set(periodKey, (this.periods.get(periodKey) ?? 0) + 1);
    }
    return this.periods.get(periodKey) ?? 0;
  }

  async ensurePeriod(merchantId: string, period: OrderQuotaPeriod): Promise<number> {
    return this.periods.get(key(merchantId, period.start)) ?? 0;
  }

  async findOpenEpisodes(merchantId: string): Promise<OrderQuotaEpisode[]> {
    return this.episodes.filter((episode) => episode.merchantId === merchantId && !episode.resolvedAt);
  }

  async getOrCreateEpisode(input: { merchantId: string; periodStart: Date; plan: "starter" | "growth" | "scale"; limit: number; reachedAt: Date; graceExpiresAt: Date }) {
    const existing = this.episodes.find((episode) =>
      episode.merchantId === input.merchantId &&
      episode.periodStart.getTime() === input.periodStart.getTime() &&
      episode.planKey === input.plan &&
      episode.limitAtStart === input.limit,
    );
    if (existing) return { episode: existing, created: false };
    const episode: OrderQuotaEpisode = {
      id: `episode_${this.episodes.length + 1}`,
      merchantId: input.merchantId,
      periodStart: input.periodStart,
      planKey: input.plan,
      limitAtStart: input.limit,
      graceExpiresAt: input.graceExpiresAt,
      blockedAt: null,
      resolvedAt: null,
    };
    this.episodes.push(episode);
    return { episode, created: true };
  }

  async markEpisodeBlocked(episodeId: string, blockedAt: Date): Promise<void> {
    const episode = this.episodes.find((item) => item.id === episodeId)!;
    episode.blockedAt = blockedAt;
  }

  async resolveEpisode(episodeId: string, resolvedAt: Date): Promise<void> {
    const episode = this.episodes.find((item) => item.id === episodeId)!;
    episode.resolvedAt = resolvedAt;
  }

  async persistNotice(notice: PersistOrderQuotaNotice): Promise<boolean> {
    if (this.notices.some((item) => item.episode.id === notice.episode.id && item.milestone === notice.milestone)) return false;
    this.notices.push(notice);
    return true;
  }

  async listMerchantsWithOpenEpisodes(): Promise<string[]> {
    return [...new Set(this.episodes.filter((episode) => !episode.resolvedAt).map((episode) => episode.merchantId))];
  }
}

function service(
  repository: MemoryOrderQuotaRepository,
  plan: { current: "starter" | "growth" | "scale" } = { current: "starter" },
) {
  const metering = { getEffectivePlan: async () => plan.current };
  const notices = {
    publish: async (milestone: string, context: any, target: OrderQuotaRepository) =>
      target.persistNotice({
        merchantId: context.merchantId,
        period: context.period,
        episode: context.episode,
        milestone,
        title: milestone,
        body: milestone,
        metadata: {},
      }),
  };
  return new OrderQuotaService(repository, metering as any, notices as any);
}

test("100th Free order starts one 72-hour grace period and keeps sales open", async () => {
  const repository = new MemoryOrderQuotaRepository();
  const quotas = service(repository);
  const reachedAt = new Date("2026-09-10T12:00:00.000Z");

  for (let number = 1; number <= 100; number++) {
    await quotas.recordCompletedOrder({ merchantId: "merchant_1", externalOrderId: `order_${number}`, completedAt: reachedAt });
  }

  const reached = await quotas.getSnapshot("merchant_1", reachedAt);
  assert.equal(reached.state, "grace");
  assert.equal(reached.canAcceptOrders, true);
  assert.equal(repository.episodes.length, 1);
  assert.deepEqual(repository.notices.map((notice) => notice.milestone), ["limit"]);
  await quotas.assertCanAcceptNewSales("merchant_1", new Date(reachedAt.getTime() + 72 * 60 * 60 * 1_000 - 1));
});

test("sales are rejected only at the persisted 72-hour deadline and reopen in the next month", async () => {
  const repository = new MemoryOrderQuotaRepository();
  const quotas = service(repository);
  const reachedAt = new Date("2026-09-25T12:00:00.000Z");

  for (let number = 1; number <= 100; number++) {
    await quotas.recordCompletedOrder({ merchantId: "merchant_1", externalOrderId: `order_${number}`, completedAt: reachedAt });
  }

  await assert.rejects(
    () => quotas.assertCanAcceptNewSales("merchant_1", new Date(reachedAt.getTime() + 72 * 60 * 60 * 1_000)),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string }).code === "merchant_sales_suspended",
  );

  const renewed = await quotas.getSnapshot("merchant_1", new Date("2026-10-01T00:00:00.000Z"));
  assert.equal(renewed.state, "active");
  assert.equal(renewed.canAcceptOrders, true);
  assert.ok(repository.episodes[0]?.resolvedAt);
});

test("an insufficient upgrade preserves the original deadline and requires the next sufficient plan", async () => {
  const repository = new MemoryOrderQuotaRepository();
  const plan: { current: "starter" | "growth" | "scale" } = { current: "starter" };
  const quotas = service(repository, plan);
  const now = new Date("2026-09-10T12:00:00.000Z");
  const periodStart = new Date("2026-09-01T00:00:00.000Z");
  repository.seedPeriod("merchant_1", periodStart, 550);

  const free = await quotas.getSnapshot("merchant_1", now);
  plan.current = "growth";
  const growth = await quotas.getSnapshot("merchant_1", new Date(now.getTime() + 60_000));

  assert.equal(growth.state, "grace");
  assert.equal(growth.requiredPlan, "scale");
  assert.equal(growth.graceExpiresAt, free.graceExpiresAt);
  assert.equal(repository.episodes.length, 1);
});

function key(merchantId: string, periodStart: Date): string {
  return `${merchantId}:${periodStart.toISOString()}`;
}

test("annual subscriber gets a fresh purchase quota each calendar month and duplicate orders count once", async () => {
  const repository = new MemoryOrderQuotaRepository();
  const quotas = service(repository, { current: "growth" });
  const completedAt = new Date("2026-09-30T12:00:00Z");
  // Subscription interval never enters the quota period calculation.
  for (let n = 0; n < 500; n++) await quotas.recordCompletedOrder({ merchantId: "annual", externalOrderId: "order_" + n, completedAt });
  await quotas.recordCompletedOrder({ merchantId: "annual", externalOrderId: "order_499", completedAt });
  const september = await quotas.getSnapshot("annual", completedAt);
  assert.equal(september.usedOrders, 500);
  const october = await quotas.getSnapshot("annual", new Date("2026-10-01T00:00:00Z"));
  assert.equal(october.usedOrders, 0);
  assert.equal(october.limit, 500);
  assert.equal(october.canAcceptOrders, true);
});
