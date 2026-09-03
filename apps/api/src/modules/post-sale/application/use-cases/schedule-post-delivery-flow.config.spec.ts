import test from "node:test";
import assert from "node:assert/strict";
import { SchedulePostDeliveryFlowUseCase } from "./schedule-post-delivery-flow.use-case.js";
import type { ScheduledMessageRepositoryPort, CreateScheduledMessageInput } from "../../domain/ports/scheduled-message-repository.port.js";
import { DEFAULT_POST_SALE_CONFIG, type PostSaleConfigService, type PostSaleCampaignConfig } from "../services/post-sale-config.service.js";

function makeDeps(configOverride: Partial<PostSaleCampaignConfig>) {
  const created: CreateScheduledMessageInput[] = [];
  const messages = {
    async create(input: CreateScheduledMessageInput) {
      created.push(input);
      return { id: `m_${created.length}`, ...input, status: "pending", sentAt: null, messageContent: null, buyerPhone: input.buyerPhone ?? null, buyerEmail: input.buyerEmail ?? null, buyerName: input.buyerName ?? null, productName: input.productName ?? null, metadata: input.metadata ?? null, createdAt: new Date() } as any;
    },
  } as unknown as ScheduledMessageRepositoryPort;

  const config = {
    async getConfig() {
      return { ...DEFAULT_POST_SALE_CONFIG, ...configOverride };
    },
  } as unknown as PostSaleConfigService;

  return { created, uc: new SchedulePostDeliveryFlowUseCase(messages, config) };
}

const baseInput = { merchantId: "m1", orderId: "o1", buyerId: "b1", buyerEmail: "b@test.local", buyerName: "B" };

test("schedule flow: all defaults on → schedules follow_up, review, cross_sell, nps", async () => {
  const { created, uc } = makeDeps({});
  const res = await uc.execute(baseInput);
  assert.equal(res.scheduled, 4);
  assert.deepEqual(created.map((c) => c.type).sort(), ["cross_sell", "follow_up", "nps", "review_request"]);
  assert.deepEqual(res.skipped, []);
});

test("schedule flow: disabling review + nps skips them", async () => {
  const { created, uc } = makeDeps({ reviewEnabled: false, npsEnabled: false });
  const res = await uc.execute(baseInput);
  assert.equal(res.scheduled, 2);
  assert.deepEqual(created.map((c) => c.type).sort(), ["cross_sell", "follow_up"]);
  assert.deepEqual(res.skipped.sort(), ["nps", "review_request"]);
});

test("schedule flow: all disabled → schedules nothing", async () => {
  const { created, uc } = makeDeps({
    followUpEnabled: false,
    reviewEnabled: false,
    crossSellEnabled: false,
    npsEnabled: false,
  });
  const res = await uc.execute(baseInput);
  assert.equal(res.scheduled, 0);
  assert.equal(created.length, 0);
  assert.equal(res.skipped.length, 4);
});

test("schedule flow: honors configured delays", async () => {
  const { created, uc } = makeDeps({ reviewDelayDays: 1, npsDelayDays: 14 });
  await uc.execute(baseInput);
  const review = created.find((c) => c.type === "review_request")!;
  const nps = created.find((c) => c.type === "nps")!;
  const followUp = created.find((c) => c.type === "follow_up")!;
  const dayMs = 24 * 60 * 60 * 1000;
  // follow_up at D+0
  assert.ok(Math.abs(review.sendAt.getTime() - followUp.sendAt.getTime() - 1 * dayMs) < 5000);
  assert.ok(Math.abs(nps.sendAt.getTime() - followUp.sendAt.getTime() - 14 * dayMs) < 5000);
});

test("schedule flow: phone present → whatsapp channel, else email", async () => {
  const withPhone = makeDeps({});
  await withPhone.uc.execute({ ...baseInput, buyerPhone: "+5511999998888" });
  assert.ok(withPhone.created.every((c) => c.channel === "whatsapp"));

  const noPhone = makeDeps({});
  await noPhone.uc.execute(baseInput);
  assert.ok(noPhone.created.every((c) => c.channel === "email"));
});
