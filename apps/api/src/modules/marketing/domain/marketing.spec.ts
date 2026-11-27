import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARKETING_STAGES,
  MarketingError,
  requireMarketingPlan,
  requireMarketingApprover,
  requireWhatsAppWindow,
  marketingPhone,
  marketingDeliveryTransition,
  marketingConsentGranted,
  withinMarketingHours,
  validateMarketingSettings,
  validateMarketingCampaign,
  type MarketingSettings,
} from "./marketing.js";

test("MKT-04/1 standard funnel has the confirmed stages", () => {
  assert.deepEqual(MARKETING_STAGES, [
    "new",
    "interested",
    "shopping",
    "payment_pending",
    "purchased",
    "lost",
  ]);
});
test("MKT-08/1 Growth and Scale are available", () => {
  requireMarketingPlan("growth");
  requireMarketingPlan("scale");
  assert.ok(true);
});
test("MKT-08/2 all lower and unresolved plans are denied", () => {
  for (const plan of ["starter", "starter179", "", "trial"])
    assert.throws(
      () => requireMarketingPlan(plan),
      (e: unknown) => e instanceof MarketingError && e.status === 403
    );
});
test("MKT-08/3 only owners and administrators approve", () => {
  requireMarketingApprover("owner");
  requireMarketingApprover("admin");
  assert.throws(
    () => requireMarketingApprover("staff"),
    /marketing_approval_forbidden/
  );
  assert.throws(
    () => requireMarketingApprover(""),
    /marketing_approval_forbidden/
  );
});
const settings: MarketingSettings = {
  id: "m",
  merchantId: "m",
  timezone: "America/Sao_Paulo",
  startHour: 9,
  endHour: 18,
  minIntervalHours: 24,
  maxMessagesPerDay: 1,
  retentionDays: 180,
  configured: true,
  updatedAt: "2026-11-27T12:00:00Z",
};
test("MKT-08/4 controls reject invalid timezones, hours and integer bounds", () => {
  validateMarketingSettings(settings);
  for (const override of [
    { timezone: "invalid-zone" },
    { startHour: 9, endHour: 9 },
    { maxMessagesPerDay: 0 },
    { minIntervalHours: 0 },
    { retentionDays: -1 },
    { retentionDays: 1.5 },
  ]) {
    assert.throws(
      () => validateMarketingSettings({ ...settings, ...override }),
      MarketingError
    );
  }
});
test("MKT-06/1 send hours use the configured timezone and exclusive end", () => {
  assert.equal(
    withinMarketingHours(settings, new Date("2026-11-27T12:00:00Z")),
    true
  );
  assert.equal(
    withinMarketingHours(settings, new Date("2026-11-27T21:00:00Z")),
    false
  );
  assert.equal(
    withinMarketingHours(
      { ...settings, startHour: 22, endHour: 6 },
      new Date("2026-11-28T02:00:00Z")
    ),
    true
  );
});
test("MKT-03/6 freeform stops exactly at the service window boundary", () => {
  const now = new Date("2026-11-28T12:00:00Z");
  requireWhatsAppWindow("2026-11-27T12:00:00.001Z", now);
  for (const time of [
    "2026-11-27T12:00:00Z",
    "invalid",
    "2026-11-29T12:00:00Z",
  ])
    assert.throws(
      () => requireWhatsAppWindow(time, now),
      /marketing_service_window_expired/
    );
});
test("MKT-06/5 delivery receipts cannot regress confirmed delivery or reading", () => {
  assert.equal(
    marketingDeliveryTransition("accepted", "delivered"),
    "delivered"
  );
  assert.equal(marketingDeliveryTransition("read", "accepted"), "read");
  assert.equal(marketingDeliveryTransition("delivered", "failed"), "delivered");
  assert.equal(
    marketingDeliveryTransition("unknown", "delivered"),
    "delivered"
  );
});
test("MKT-06/2 an absent or revoked permission never authorizes a campaign", () => {
  assert.equal(marketingConsentGranted(null), false);
  assert.equal(
    marketingConsentGranted({
      id: "c",
      merchantId: "m",
      contactId: "x",
      channel: "whatsapp",
      status: "revoked",
      version: "v1",
      text: "yes",
      source: "wa",
      recordedAt: "now",
      evidenceId: "e",
    }),
    false
  );
});
test("MKT-05/1 drafts need concrete content and explicit integer spending limits", () => {
  const draft = {
    name: "Novidades",
    body: "Conheça nossa coleção",
    budgetCents: 1000,
    maxUnitCostCents: 20,
    language: "pt_BR",
    segment: {},
  };
  validateMarketingCampaign(draft);
  for (const override of [
    { budgetCents: 0 },
    { maxUnitCostCents: 0 },
    { body: "{{1}}" },
    { maxUnitCostCents: 1001 },
    { budgetCents: 1.2 },
  ]) {
    assert.throws(
      () => validateMarketingCampaign({ ...draft, ...override }),
      /marketing_campaign_invalid/
    );
  }
});
test("MKT-01/1 incoming phone normalization preserves international routing", () => {
  assert.equal(marketingPhone("(11) 99999-1234"), "5511999991234");
  assert.equal(marketingPhone("+55 11 99999-1234"), "5511999991234");
  assert.equal(marketingPhone("+1 202-555-0143"), "12025550143");
  assert.equal(marketingPhone("12025550143"), "12025550143");
  assert.equal(marketingPhone("+44 20 7946 0958"), "442079460958");
  assert.equal(marketingPhone("5511999991234"), "5511999991234");
  assert.throws(() => marketingPhone("123"), /marketing_phone_invalid/);
});
