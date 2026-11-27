import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { marketingTestFixture } from "../marketing-test-fixture.js";
import { MarketingCampaignsService } from "./marketing-campaigns.service.js";
import type { MerchantMarketingMessaging } from "../../../shared/contracts/marketing.js";

test("MKT-07/4 campaign report keeps every provider outcome disjoint and preserves selected and eligible totals", async () => {
  const f = await setup();
  try {
    const c = await f.approved();
    const states = [
      "queued",
      "sending",
      "accepted",
      "delivered",
      "read",
      "failed",
      "suppressed",
      "unknown",
    ] as const;
    await f.repository.transaction(f.merchantId, "seed-report", async (tx) => {
      await tx.clearUnsentRecipients(c.id);
      await tx.saveCampaign({
        ...c,
        audience: { selected: 10, eligible: 8, excluded: { no_consent: 2 } },
      });
      for (const status of states)
        await tx.saveRecipient({
          id: randomUUID(),
          merchantId: f.merchantId,
          campaignId: c.id,
          contactId: randomUUID(),
          campaignVersion: c.version,
          status,
          leaseToken: null,
          leaseUntil: null,
          attemptedAt: null,
          costReservedCents: 0,
          providerMessageId: null,
          reason: null,
          updatedAt: f.now,
        });
    });
    const result = await f.service.report(f.merchantId, c.id);
    assert.equal(result.selected, 10);
    assert.equal(result.eligible, 8);
    assert.deepEqual(result.excluded, { no_consent: 2 });
    assert.deepEqual(result.counts, {
      queued: 1,
      sending: 1,
      accepted: 1,
      delivered: 1,
      read: 1,
      failed: 1,
      suppressed: 1,
      unknown: 1,
    });
    assert.equal(result.attributedRevenueCents, null);
  } finally {
    await f.cleanup();
  }
});
async function setup() {
  const f = marketingTestFixture();
  let plan = "growth";
  const messaging: MerchantMarketingMessaging = {
    sendFreeform: async () => ({ status: "accepted" }),
    sendOpening: async () => ({ status: "accepted" }),
    submitTemplate: async () => ({
      name: "merchant_campaign",
      status: "approved",
      wabaId: "waba-1",
    }),
    checkTemplate: async () => true,
    sendCampaign: async () => ({ status: "accepted" }),
  };
  const service = new MarketingCampaignsService(
    f.repository,
    {
      plan: async () => plan,
      buyer: async () => null,
      verifiedAccount: async () => null,
      blockedByPreference: async () => false,
    },
    messaging,
    { now: () => new Date(f.now) }
  );
  const draft = {
    name: "Novidades",
    body: "Conheça nossa coleção na loja.",
    segment: {},
    budgetCents: 1000,
    maxUnitCostCents: 20,
  };
  await service.configure(f.merchantId, "owner", {
    timezone: "America/Sao_Paulo",
    startHour: 9,
    endHour: 18,
    minIntervalHours: 24,
    maxMessagesPerDay: 1,
    retentionDays: 180,
  });
  const contact = f.contact({ phone: "5511999991234" });
  await f.repository.transaction(f.merchantId, "seed", async (tx) => {
    await tx.saveContact(contact);
    await tx.saveConsent({
      id: randomUUID(),
      merchantId: f.merchantId,
      contactId: contact.id,
      channel: "whatsapp",
      status: "granted",
      version: "v1",
      text: "Sim",
      source: "wa",
      recordedAt: f.now,
      evidenceId: "event",
    });
  });
  const approved = async () => {
    const c = await service.create(f.merchantId, "owner", draft);
    await service.submitTemplate(f.merchantId, "owner", c.id);
    return service.approve(f.merchantId, "owner", c.id, c.version, "owner-1");
  };
  return {
    ...f,
    service,
    messaging,
    draft,
    selectedContact: contact,
    approved,
    setPlan: (value: string) => {
      plan = value;
    },
  };
}
test("MKT-05/1 campaign draft persists concrete content and explicit budget", async () => {
  const f = await setup();
  try {
    const c = await f.service.create(f.merchantId, "owner", f.draft);
    const saved = await f.service.get(f.merchantId, c.id);
    assert.equal(saved.status, "draft");
    assert.equal(saved.body, f.draft.body);
    assert.equal(saved.budgetCents, 1000);
    assert.equal(saved.approvedBy, null);
  } finally {
    await f.cleanup();
  }
});
test("MKT-05/2 audience review distinguishes selected eligible and exclusions", async () => {
  const f = await setup();
  try {
    await f.repository.transaction(f.merchantId, "seed", (tx) =>
      tx.saveContact(f.contact({ phone: "5511988881111" }))
    );
    const c = await f.service.create(f.merchantId, "owner", f.draft);
    const review = await f.service.review(f.merchantId, c.id);
    assert.equal(review.selected, 2);
    assert.equal(review.eligible, 1);
    assert.deepEqual(review.excluded, { no_consent: 1 });
    assert.equal(review.estimatedReservationCents, 20);
  } finally {
    await f.cleanup();
  }
});
test("MKT-05/3 approval freezes the content version and only eligible recipients", async () => {
  const f = await setup();
  try {
    const c = await f.approved();
    assert.equal(c.approvedVersion, 1);
    assert.equal(c.approvedBy, "owner-1");
    const recipients = await f.repository.transaction(
      f.merchantId,
      "read",
      (tx) => tx.recipients(c.id)
    );
    assert.equal(recipients.length, 1);
    assert.equal(recipients[0].contactId, f.selectedContact.id);
    assert.equal(recipients[0].campaignVersion, c.version);
    await f.repository.transaction(f.merchantId, "seed", (tx) =>
      tx.saveContact(f.contact())
    );
    assert.equal(
      (
        await f.repository.transaction(f.merchantId, "read", (tx) =>
          tx.recipients(c.id)
        )
      ).length,
      1
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-05/4 editing approved content removes the prior approval and audience", async () => {
  const f = await setup();
  try {
    const c = await f.approved();
    const updated = await f.service.update(
      f.merchantId,
      "owner",
      c.id,
      c.version,
      { ...f.draft, body: "Outra comunicação" }
    );
    assert.equal(updated.status, "draft");
    assert.equal(updated.approvedVersion, null);
    assert.equal(updated.version, 2);
    assert.equal(
      (
        await f.repository.transaction(f.merchantId, "read", (tx) =>
          tx.recipients(c.id)
        )
      ).length,
      0
    );
    await assert.rejects(
      f.service.schedule(f.merchantId, "owner", c.id, null),
      /marketing_campaign_approval_required/
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-05/5 scheduled campaign is absent from the due queue until its time", async () => {
  const f = await setup();
  try {
    const c = await f.approved();
    const at = "2026-11-28T12:00:00Z";
    await f.service.schedule(f.merchantId, "owner", c.id, at);
    assert.equal(
      (await f.repository.dueCampaigns(new Date(f.now), 100)).some(
        (x) => x.id === c.id
      ),
      false
    );
    assert.equal(
      (await f.repository.dueCampaigns(new Date(at), 100)).some(
        (x) => x.id === c.id
      ),
      true
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-05/6 pausing a running campaign removes it from the due queue", async () => {
  const f = await setup();
  try {
    const c = await f.approved();
    await f.service.schedule(f.merchantId, "owner", c.id, null);
    await f.service.pause(f.merchantId, "owner", c.id);
    assert.equal((await f.service.get(f.merchantId, c.id)).status, "paused");
    assert.equal(
      (await f.repository.dueCampaigns(new Date(f.now), 100)).some(
        (x) => x.id === c.id
      ),
      false
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/2 unapproved provider template cannot receive local approval", async () => {
  const f = await setup();
  try {
    const c = await f.service.create(f.merchantId, "owner", f.draft);
    await f.service.submitTemplate(f.merchantId, "owner", c.id);
    f.messaging.checkTemplate = async () => false;
    await assert.rejects(
      f.service.approve(f.merchantId, "owner", c.id, c.version, "owner"),
      /marketing_approved_template_required/
    );
    assert.equal(
      (await f.service.get(f.merchantId, c.id)).approvedVersion,
      null
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-08/3 staff cannot create or approve campaigns or configure limits", async () => {
  const f = await setup();
  try {
    await assert.rejects(
      f.service.create(f.merchantId, "staff", f.draft),
      /marketing_approval_forbidden/
    );
    const c = await f.service.create(f.merchantId, "owner", f.draft);
    await assert.rejects(
      f.service.approve(f.merchantId, "staff", c.id, c.version, "staff"),
      /marketing_approval_forbidden/
    );
    await assert.rejects(
      f.service.configure(f.merchantId, "staff", {
        timezone: "UTC",
        startHour: 0,
        endHour: 24,
        minIntervalHours: 1,
        maxMessagesPerDay: 1,
        retentionDays: 1,
      }),
      /marketing_approval_forbidden/
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-07/5 campaign report omits financial attribution without evidence", async () => {
  const f = await setup();
  try {
    const c = await f.approved();
    const report = await f.service.report(f.merchantId, c.id);
    assert.equal(report.attributedRevenueCents, null);
    assert.equal(report.counts.queued, 1);
    assert.equal(report.counts.delivered, 0);
    assert.equal(report.counts.read, 0);
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/4 unknown template submission keeps a durable name and reconciles with a read instead of resubmitting", async () => {
  const f = await setup();
  try {
    let calls = 0;
    f.messaging.submitTemplate = async () => {
      calls++;
      throw new Error("timeout_after_acceptance");
    };
    f.messaging.inspectTemplate = async (input) => ({
      name: input.name,
      status: "approved",
      wabaId: "recovered-waba",
    });
    const c = await f.service.create(f.merchantId, "owner", f.draft);
    const unknown = await f.service.submitTemplate(f.merchantId, "owner", c.id);
    assert.equal(unknown.templateStatus, "submission_unknown");
    assert.equal(unknown.templateName, `campaign_${c.id.replace(/-/g, "")}_v1`);
    await assert.rejects(
      f.service.submitTemplate(f.merchantId, "owner", c.id),
      /marketing_template_reconciliation_required/
    );
    const recovered = await f.service.syncTemplate(f.merchantId, "owner", c.id);
    assert.equal(recovered.templateStatus, "approved");
    assert.equal(recovered.templateWabaId, "recovered-waba");
    assert.equal(calls, 1);
    const approved = await f.service.approve(
      f.merchantId,
      "owner",
      c.id,
      c.version,
      "owner"
    );
    assert.equal(approved.approvedVersion, 1);
  } finally {
    await f.cleanup();
  }
});
