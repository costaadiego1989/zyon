import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { GetFunnelUseCase } from "./get-funnel.use-case.js";

interface StubEvent {
  sessionId: string;
  eventName: string;
  occurredAt: Date;
  metadata?: Record<string, unknown> | null;
}

function buildPrismaStub(events: StubEvent[]): PrismaClient {
  return {
    checkoutEvent: {
      findMany: async (args: any) => {
        const where = args?.where ?? {};
        const from: Date | undefined = where.occurredAt?.gte;
        const to: Date | undefined = where.occurredAt?.lte;
        const startsWith: string | undefined = where.sessionId?.startsWith;
        const inList: string[] | undefined = where.sessionId?.in;
        return events
          .filter((e) => (from ? e.occurredAt >= from : true))
          .filter((e) => (to ? e.occurredAt <= to : true))
          .filter((e) => (startsWith ? e.sessionId.startsWith(startsWith) : true))
          .filter((e) => (inList ? inList.includes(e.sessionId) : true))
          .map((e) => ({ sessionId: e.sessionId, eventName: e.eventName, occurredAt: e.occurredAt, metadata: e.metadata ?? null }));
      },
    },
    checkoutSession: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;
}

describe("GetFunnelUseCase device breakdown", () => {
  it("groups sessions by metadata.device and returns real segment counts", async () => {
    const now = new Date();
    const events: StubEvent[] = [
      { sessionId: "chk_a", eventName: "checkout_started", occurredAt: now, metadata: { device: "mobile" } },
      { sessionId: "chk_a", eventName: "order_completed", occurredAt: now },
      { sessionId: "chk_b", eventName: "checkout_started", occurredAt: now, metadata: { device: "mobile" } },
      { sessionId: "chk_c", eventName: "checkout_started", occurredAt: now, metadata: { device: "desktop" } },
      { sessionId: "chk_c", eventName: "order_completed", occurredAt: now },
    ];
    const useCase = new GetFunnelUseCase(buildPrismaStub(events));
    const result = await useCase.execute("m1", "7d", { breakdown: "device" });

    assert.ok(result.breakdowns);
    const mobile = result.breakdowns!.mobile;
    const desktop = result.breakdowns!.desktop;
    const tablet = result.breakdowns!.tablet;

    // mobile: 2 sessions started, 1 completed
    assert.equal(mobile.steps[0].count, 2);
    assert.equal(mobile.overallConversion, 50);
    // desktop: 1 session, 1 completed
    assert.equal(desktop.steps[0].count, 1);
    assert.equal(desktop.overallConversion, 100);
    // tablet: no data -> honest zero
    assert.equal(tablet.steps[0].count, 0);
    assert.equal(tablet.overallConversion, 0);
  });

  it("returns zeroed segments when no device metadata exists (pre-migration)", async () => {
    const now = new Date();
    const events: StubEvent[] = [
      { sessionId: "chk_x", eventName: "checkout_started", occurredAt: now },
    ];
    const useCase = new GetFunnelUseCase(buildPrismaStub(events));
    const result = await useCase.execute("m1", "7d", { breakdown: "device" });

    assert.ok(result.breakdowns);
    for (const seg of Object.values(result.breakdowns!)) {
      assert.equal(seg.steps[0].count, 0);
      assert.equal(seg.overallConversion, 0);
    }
  });
});

describe("GetFunnelUseCase payment_method breakdown", () => {
  it("groups sessions by metadata.payment_method and returns real segment counts", async () => {
    const now = new Date();
    const events: StubEvent[] = [
      { sessionId: "chk_a", eventName: "payment_method_selected", occurredAt: now, metadata: { payment_method: "pix" } },
      { sessionId: "chk_a", eventName: "order_completed", occurredAt: now },
      { sessionId: "chk_b", eventName: "payment_method_selected", occurredAt: now, metadata: { payment_method: "card" } },
    ];
    const useCase = new GetFunnelUseCase(buildPrismaStub(events));
    const result = await useCase.execute("m1", "7d", { breakdown: "payment_method" });

    assert.ok(result.breakdowns);
    const pix = result.breakdowns!.pix;
    const card = result.breakdowns!.card;
    const boleto = result.breakdowns!.boleto;

    assert.equal(pix.steps[0].count, 1);
    assert.equal(pix.overallConversion, 100);
    assert.equal(card.steps[0].count, 1);
    assert.equal(card.overallConversion, 0);
    assert.equal(boleto.steps[0].count, 0);
  });
});
