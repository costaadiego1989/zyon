import assert from "node:assert/strict";
import test from "node:test";
import { GetStorefrontLiveSessionsUseCase, resolveLiveSessionStage } from "./get-storefront-live-sessions.use-case.js";
import { TrackStorefrontEventUseCase } from "./track-storefront-event.use-case.js";

test("tracks events through the telemetry port without blocking the storefront on failure", async () => {
  const events: unknown[] = [];
  const useCase = new TrackStorefrontEventUseCase({
    recordEvent: async (event) => { events.push(event); },
    listLiveSessions: async () => [],
  });
  await useCase.execute({ merchantId: "merchant_a", conversationId: "conversation_a", event: "cart_viewed", metadata: { device: "mobile" } });
  assert.deepEqual(events, [{ merchantId: "merchant_a", conversationId: "conversation_a", event: "cart_viewed", metadata: { device: "mobile" } }]);

  const unavailable = new TrackStorefrontEventUseCase({
    recordEvent: async () => { throw new Error("database_unavailable"); },
    listLiveSessions: async () => [],
  });
  await unavailable.execute({ merchantId: "merchant_a", conversationId: "conversation_a", event: "cart_viewed" });
});

test("maps live sessions without exposing persistence records", async () => {
  const since: Date[] = [];
  const useCase = new GetStorefrontLiveSessionsUseCase({
    recordEvent: async () => undefined,
    listLiveSessions: async (_merchantId, requestedSince) => {
      since.push(requestedSince);
      return [
        { sessionId: "one", eventNames: ["cart_viewed"], updatedAt: new Date("2026-09-07T12:00:00.000Z"), abandonmentScore: null },
        { sessionId: "two", eventNames: ["payment_method_selected"], updatedAt: new Date("2026-09-07T12:01:00.000Z"), abandonmentScore: 42 },
      ];
    },
  });
  assert.deepEqual(await useCase.execute("merchant_a"), {
    sessions: [
      { sessionId: "one", buyerPhone: "", buyerEmail: "", buyerName: "", stage: "shipping", lastActivityAt: "2026-09-07T12:00:00.000Z", abandonmentScore: 0 },
      { sessionId: "two", buyerPhone: "", buyerEmail: "", buyerName: "", stage: "payment", lastActivityAt: "2026-09-07T12:01:00.000Z", abandonmentScore: 42 },
    ],
    total: 2,
    status: "active",
  });
  assert.equal(since.length, 1);
  assert.ok(since[0] instanceof Date);
  assert.equal(resolveLiveSessionStage(["order_completed"]), "completed");
});
