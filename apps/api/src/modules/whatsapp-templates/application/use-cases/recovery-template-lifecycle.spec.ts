import test from "node:test";
import assert from "node:assert/strict";
import { RecoveryTemplateLifecycleUseCase } from "./recovery-template-lifecycle.use-case.js";
import type { RecoveryLifecycleRecord, RecoveryLifecycleRepository } from "../../domain/ports/recovery-template-lifecycle.port.js";
import type { TemplateSubmissionPort, TemplateSubmissionStatus, SubmitTemplateInput } from "../../domain/ports/template-submission.port.js";
import type { WhatsAppConfigRepository, WhatsAppChannelConfigEntity } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";

const now = new Date("2026-09-05T10:00:00Z");
const sid = `HX${"a".repeat(32)}`;
const config: WhatsAppChannelConfigEntity = {
  id: "connection", merchantId: "merchant-a", provider: "TWILIO", enabled: true, status: "ACTIVE",
  whatsappNumber: "5511999990000", credentials: { accountSid: "AC-tenant", authToken: "fake-secret", senderId: "whatsapp:+5511999990000" },
  createdAt: now, updatedAt: now,
};
function record(patch: Partial<RecoveryLifecycleRecord> = {}): RecoveryLifecycleRecord {
  return { id: "template-a", merchantId: "merchant-a", type: "cart_recovery", channel: "whatsapp", name: "Recovery",
    subject: null, body: "Olá {{buyerName}}, retome em {{link}}", isActive: true,
    metaCategory: "MARKETING", metaLanguage: "pt_BR", metaTemplateBody: null, metaVariableMap: null,
    twilioContentSid: null, metaStatus: "draft", metaRejectionReason: null, metaRevision: 3,
    metaLastCheckedAt: null, metaNextCheckAt: now, createdAt: now, updatedAt: now, ...patch };
}
function setup(options: {
  row?: Partial<RecoveryLifecycleRecord>; connected?: boolean; configError?: boolean;
  claim?: boolean; create?: TemplateSubmissionStatus | Error; sync?: TemplateSubmissionStatus | Error;
  completeFails?: boolean;
} = {}) {
  const row = record(options.row);
  const completions: { patch: Parameters<RecoveryLifecycleRepository["complete"]>[1]; submitting: boolean }[] = [];
  const creates: SubmitTemplateInput[] = [];
  const syncs: [string, string][] = [];
  const saves: Parameters<RecoveryLifecycleRepository["save"]>[] = [];
  const ensured: string[] = [];
  let claimed = false;
  const repo: RecoveryLifecycleRepository = {
    async ensure(merchantId) { ensured.push(merchantId); },
    async read(merchantId) {
      assert.equal(merchantId, row.merchantId);
      return { whatsapp: row, email: record({ channel: "email", subject: "Seu carrinho", body: "Retome {{link}}" }) };
    },
    async save(...args) { saves.push(args); },
    async due(at) { assert.equal(at, now); return [row]; },
    async claim(candidate) {
      assert.equal(candidate, row);
      if (claimed || options.claim === false) return false;
      claimed = true;
      return true;
    },
    async complete(candidate, patch, submitting) {
      assert.equal(candidate, row);
      completions.push({ patch, submitting });
      if (options.completeFails) throw new Error("database unavailable");
    },
    async seedMerchantPage() { return undefined; },
  };
  const submission: TemplateSubmissionPort = {
    async createAndSubmit(input) {
      creates.push(input);
      if (options.create instanceof Error) throw options.create;
      return options.create ?? { contentSid: sid, status: "submitted" };
    },
    async syncStatus(...args) {
      syncs.push(args);
      if (options.sync instanceof Error) throw options.sync;
      return options.sync ?? { contentSid: sid, status: "approved" };
    },
  };
  const configs = { async findByMerchantId(merchantId: string) {
    assert.equal(merchantId, row.merchantId);
    if (options.configError) throw new Error("unavailable");
    return options.connected === false ? null : config;
  } } as WhatsAppConfigRepository;
  return { service: new RecoveryTemplateLifecycleUseCase(repo, submission, configs), completions, creates, syncs, saves, ensured };
}

test("disconnected merchant sees email and waits without submitting", async () => {
  const h = setup({ connected: false });
  const view = await h.service.get("merchant-a");
  assert.equal(view.effectiveChannel, "email");
  assert.equal(view.whatsapp.status, "waiting_connection");
  assert.equal(view.whatsappConnected, false);
  await h.service.processDue(now);
  assert.equal(h.creates.length, 0);
  assert.deepEqual(h.completions, [{ submitting: true, patch: { status: "waiting_connection", nextCheckAt: new Date(now.getTime() + 60_000) } }]);
});
test("failed connection lookup cannot activate WhatsApp", async () => {
  const h = setup({ configError: true, row: { metaStatus: "approved", twilioContentSid: sid } });
  assert.equal((await h.service.get("merchant-a")).effectiveChannel, "email");
  await h.service.processDue(now);
  assert.equal(h.syncs.length, 0);
});
test("connected approved template activates WhatsApp", async () => {
  const h = setup({ row: { metaStatus: "approved", twilioContentSid: sid, metaLastCheckedAt: new Date() } });
  assert.equal((await h.service.get("merchant-a")).effectiveChannel, "whatsapp_template");
});
test("approved revision with a stale approval check keeps email effective", async () => {
  const h = setup({ row: { metaStatus: "approved", twilioContentSid: sid, metaLastCheckedAt: new Date(Date.now() - 16 * 60_000) } });
  assert.equal((await h.service.get("merchant-a")).effectiveChannel, "email");
});
for (const status of ["submitted", "rejected", "paused", "disabled", "submission_unknown"]) {
  test(`${status} keeps email effective`, async () => {
    const h = setup({ row: { metaStatus: status, twilioContentSid: sid } });
    assert.equal((await h.service.get("merchant-a")).effectiveChannel, "email");
  });
}
test("concurrent scans submit once only after acquiring the claim", async () => {
  const h = setup();
  await Promise.all([h.service.processDue(now), h.service.processDue(now)]);
  assert.equal(h.creates.length, 1);
  const input = h.creates[0]!;
  assert.equal(input.merchantId, "merchant-a");
  assert.equal(input.category, "MARKETING");
  assert.match(input.friendlyName, /^recovery_[a-f0-9]{20}_v3$/);
  assert.equal(input.metaBody, "Olá {{1}}, retome em {{2}}");
  assert.equal(h.completions[0]?.patch.contentSid, sid);
});
test("losing claim causes no submission or completion", async () => {
  const h = setup({ claim: false });
  await h.service.processDue(now);
  assert.equal(h.creates.length + h.syncs.length + h.completions.length, 0);
});
for (const status of ["submission_unknown", "submitting"]) {
  test(`${status} with no SID is held without another POST`, async () => {
    const h = setup({ row: { metaStatus: status } });
    await h.service.processDue(now);
    assert.equal(h.creates.length + h.syncs.length, 0);
    assert.equal(h.completions[0]?.patch.status, "submission_unknown");
    assert.equal(h.completions[0]?.patch.nextCheckAt, null);
  });
}
test("uncertain create without SID stops automatic creation retries", async () => {
  const h = setup({ create: { contentSid: "", status: "submission_unknown" } });
  await h.service.processDue(now);
  assert.equal(h.completions[0]?.patch.status, "submission_unknown");
  assert.equal(h.completions[0]?.patch.contentSid, null);
  assert.equal(h.completions[0]?.patch.nextCheckAt, null);
});
test("uncertain approval with a SID schedules polling and never recreates", async () => {
  const h = setup({ row: { metaStatus: "submission_unknown", twilioContentSid: sid } });
  await h.service.processDue(now);
  assert.equal(h.creates.length, 0);
  assert.deepEqual(h.syncs, [["merchant-a", sid]]);
  assert.equal(h.completions[0]?.patch.status, "approved");
});
for (const status of ["approved", "submitted", "rejected", "paused", "disabled"] as const) {
  test(`poll persists ${status} only for matching SID`, async () => {
    const h = setup({ row: { metaStatus: "submitted", twilioContentSid: sid }, sync: { contentSid: sid, status, rejectionReason: "provider reason" } });
    await h.service.processDue(now);
    assert.equal(h.completions[0]?.patch.status, status);
    assert.equal(h.completions[0]?.patch.checkedAt, now);
    assert.equal(h.completions[0]?.patch.reason, "provider reason");
  });
}
test("stale SID response cannot approve current revision", async () => {
  const h = setup({ row: { metaStatus: "submitted", twilioContentSid: sid }, sync: { contentSid: `HX${"b".repeat(32)}`, status: "approved" } });
  await h.service.processDue(now);
  assert.equal(h.completions[0]?.patch.status, "submitted");
  assert.equal(h.completions[0]?.patch.checkedAt, undefined);
});
test("inconclusive poll preserves prior state and does not claim a successful check", async () => {
  const h = setup({ row: { metaStatus: "paused", twilioContentSid: sid }, sync: { contentSid: sid, status: "unknown" } });
  await h.service.processDue(now);
  assert.equal(h.completions[0]?.patch.status, "paused");
  assert.equal(h.completions[0]?.patch.checkedAt, undefined);
});
test("create throw or failed persistence cannot cause another POST", async () => {
  for (const options of [{ create: new Error("network") }, { completeFails: true }]) {
    const h = setup(options);
    await h.service.processDue(now);
    await h.service.processDue(now);
    assert.equal(h.creates.length, 1);
    assert.equal(h.completions.at(-1)?.patch.status, "submission_unknown");
  }
});
test("invalid edit is rejected before initializing or changing tenant records", async () => {
  const h = setup();
  await assert.rejects(h.service.save("merchant-a", { whatsapp: { body: "discount {{coupon}}", revision: 1 } }));
  assert.equal(h.ensured.length + h.saves.length, 0);
});
test("valid edit forwards revision and normalized content to the authenticated tenant", async () => {
  const h = setup();
  await h.service.save("merchant-a", { merchantId: "merchant-b", email: { subject: " Retome ", body: " {{link}} " }, whatsapp: { body: " Retome {{link}} ", revision: 3 } });
  assert.deepEqual(h.saves, [["merchant-a", { email: { subject: "Retome", body: "{{link}}" }, whatsapp: { body: "Retome {{link}}", revision: 3 } }]]);
});
