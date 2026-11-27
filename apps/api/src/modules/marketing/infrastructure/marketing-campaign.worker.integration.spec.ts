import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { marketingTestFixture } from "../marketing-test-fixture.js";
import { MarketingCampaignsService } from "../application/marketing-campaigns.service.js";
import { MarketingCampaignWorker } from "./marketing-campaign.worker.js";
import { MarketingObservability } from "./marketing-observability.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import type {
  MerchantMarketingMessaging,
  MerchantMarketingSendResult,
} from "../../../shared/contracts/marketing.js";
async function setup() {
  const f = marketingTestFixture();
  let plan = "growth",
    time = new Date(f.now),
    sends = 0;
  const metrics = new MetricsService();
  const context = {
    plan: async () => plan,
    buyer: async () => null,
    verifiedAccount: async () => null,
    blockedByPreference: async () => false,
  };
  const clock = { now: () => time };
  let result: MerchantMarketingSendResult = {
    status: "accepted",
    messageId: "wamid-campaign",
  };
  const messaging: MerchantMarketingMessaging = {
    sendFreeform: async () => ({ status: "accepted" }),
    sendOpening: async () => ({ status: "accepted" }),
    submitTemplate: async () => ({
      name: "template",
      status: "approved",
      wabaId: "waba",
    }),
    checkTemplate: async () => true,
    sendCampaign: async () => {
      sends++;
      return result;
    },
  };
  const service = new MarketingCampaignsService(
    f.repository,
    context,
    messaging,
    clock
  );
  const observer = new MarketingObservability(metrics, {
    log: () => {},
    warn: () => {},
  });
  const worker = new MarketingCampaignWorker(
    f.repository,
    context,
    messaging,
    clock,
    observer
  );
  const contact = f.contact({ phone: "5511999991234" });
  const consent = {
    id: randomUUID(),
    merchantId: f.merchantId,
    contactId: contact.id,
    channel: "whatsapp" as const,
    status: "granted" as const,
    version: "v1",
    text: "Sim",
    source: "wa",
    recordedAt: f.now,
    evidenceId: "grant",
  };
  await f.repository.transaction(f.merchantId, "seed", async (tx) => {
    await tx.saveContact(contact);
    await tx.saveConsent(consent);
  });
  await service.configure(f.merchantId, "owner", {
    timezone: "America/Sao_Paulo",
    startHour: 9,
    endHour: 18,
    minIntervalHours: 24,
    maxMessagesPerDay: 1,
    retentionDays: 180,
  });
  const c = await service.create(f.merchantId, "owner", {
    name: "Oferta",
    body: "Novidades da loja",
    segment: {},
    budgetCents: 100,
    maxUnitCostCents: 20,
  });
  await service.submitTemplate(f.merchantId, "owner", c.id);
  await service.approve(f.merchantId, "owner", c.id, c.version, "owner");
  await service.schedule(f.merchantId, "owner", c.id, null);
  return {
    ...f,
    service,
    worker,
    context,
    messaging,
    clock,
    campaign: c,
    selectedContact: contact,
    consent,
    observer,
    sends: () => sends,
    setPlan: (v: string) => {
      plan = v;
    },
    setTime: (v: string) => {
      time = new Date(v);
    },
    setResult: (v: MerchantMarketingSendResult) => {
      result = v;
    },
    cleanup: async () => {
      metrics.registry.clear();
      await f.cleanup();
    },
  };
}
test("MKT-06/3 campaign acceptance is persisted once with its provider id and reserved budget", async () => {
  const f = await setup();
  try {
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    const report = await f.service.report(f.merchantId, f.campaign.id);
    assert.equal(f.sends(), 1);
    assert.equal(report.counts.accepted, 1);
    assert.equal(report.counts.delivered, 0);
    assert.equal(report.reservedCents, 20);
    assert.equal(report.campaign.status, "completed");
  } finally {
    await f.cleanup();
  }
});
test("MKT-02/5 revocation after scheduling suppresses the pending recipient", async () => {
  const f = await setup();
  try {
    await f.repository.transaction(f.merchantId, "revoke", (tx) =>
      tx.saveConsent({
        ...f.consent,
        status: "revoked",
        recordedAt: "2026-11-27T12:00:01Z",
      })
    );
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    const report = await f.service.report(f.merchantId, f.campaign.id);
    assert.equal(f.sends(), 0);
    assert.equal(report.counts.suppressed, 1);
    assert.equal(report.reservedCents, 0);
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/4 unknown provider outcome is held without an automatic resend", async () => {
  const f = await setup();
  try {
    f.setResult({ status: "unknown", reason: "provider_acceptance_unknown" });
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    const report = await f.service.report(f.merchantId, f.campaign.id);
    assert.equal(f.sends(), 1);
    assert.equal(report.counts.unknown, 1);
    assert.equal(report.counts.accepted, 0);
    assert.equal(report.reservedCents, 20);
    assert.equal(report.campaign.status, "paused");
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/5 authenticated status projection advances delivery and cannot regress it", async () => {
  const f = await setup();
  try {
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    await f.repository.transaction(f.merchantId, "receipt", async (tx) => {
      await tx.updateDelivery("wamid-campaign", "delivered");
      await tx.updateDelivery("wamid-campaign", "accepted");
    });
    const report = await f.service.report(f.merchantId, f.campaign.id);
    assert.equal(report.counts.delivered, 1);
    assert.equal(report.counts.accepted, 0);
    assert.equal(
      await f.repository.transaction("other-store", "receipt", (tx) =>
        tx.updateDelivery("wamid-campaign", "read")
      ),
      0
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/6 prior recovery reservation prevents a competing campaign", async () => {
  const f = await setup();
  try {
    await f.repository.transaction(f.merchantId, "recovery", (tx) =>
      tx.reserveCommercial(
        f.selectedContact.identityKey,
        "recovery-1",
        f.now,
        24,
        1
      )
    );
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    assert.equal(f.sends(), 0);
    const recipients = await f.repository.transaction(
      f.merchantId,
      "read",
      (tx) => tx.recipients(f.campaign.id)
    );
    assert.equal(recipients[0].status, "suppressed");
    assert.equal(recipients[0].reason, "frequency_limit");
  } finally {
    await f.cleanup();
  }
});
test("MKT-08/2 downgrade pauses an approved campaign before any provider call", async () => {
  const f = await setup();
  try {
    f.setPlan("starter");
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    assert.equal(f.sends(), 0);
    const c = await f.repository.transaction(f.merchantId, "read", (tx) =>
      tx.campaign(f.campaign.id)
    );
    assert.equal(c?.status, "paused");
    assert.equal(c?.pauseReason, "plan_unavailable");
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/1 outside configured hours leaves the recipient queued and budget untouched", async () => {
  const f = await setup();
  try {
    f.setTime("2026-11-27T23:00:00Z");
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    const report = await f.service.report(f.merchantId, f.campaign.id);
    assert.equal(report.counts.queued, 1);
    assert.equal(report.reservedCents, 0);
    assert.equal(f.sends(), 0);
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/4 concurrent worker instances cannot dispatch the same recipient twice", async () => {
  const f = await setup();
  try {
    const second = new MarketingCampaignWorker(
      f.repository,
      f.context,
      f.messaging,
      f.clock,
      f.observer
    );
    await Promise.all([
      f.worker.runCampaign(f.merchantId, f.campaign.id),
      second.runCampaign(f.merchantId, f.campaign.id),
    ]);
    assert.equal(f.sends(), 1);
    assert.equal(
      (await f.service.report(f.merchantId, f.campaign.id)).counts.accepted,
      1
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/4 sending marker is durable before external I/O and a crashed lease is never resent", async () => {
  const f = await setup();
  try {
    const recipients = await f.repository.transaction(
      f.merchantId,
      "read",
      (tx) => tx.recipients(f.campaign.id)
    );
    const original = recipients[0];
    await f.repository.transaction(
      f.merchantId,
      `campaign:${f.campaign.id}`,
      async (tx) => {
        await tx.saveRecipient({
          ...original,
          status: "sending",
          leaseToken: "crashed-worker",
          leaseUntil: "2026-11-27T11:59:00Z",
          attemptedAt: "2026-11-27T11:57:00Z",
          costReservedCents: 20,
        });
        const campaign = await tx.campaign(f.campaign.id);
        await tx.saveCampaign({ ...campaign!, reservedCents: 20 });
      }
    );
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    assert.equal(f.sends(), 0);
    const report = await f.service.report(f.merchantId, f.campaign.id);
    assert.equal(report.counts.unknown, 1);
    assert.equal(report.reservedCents, 20);
    assert.equal(report.campaign.status, "paused");
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/3 acceptance without a provider identifier is kept unknown", async () => {
  const f = await setup();
  try {
    f.setResult({ status: "accepted" });
    await f.worker.runCampaign(f.merchantId, f.campaign.id);
    const report = await f.service.report(f.merchantId, f.campaign.id);
    assert.equal(report.counts.accepted, 0);
    assert.equal(report.counts.unknown, 1);
    assert.equal(report.reservedCents, 20);
  } finally {
    await f.cleanup();
  }
});
