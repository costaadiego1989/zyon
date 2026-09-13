import test from "node:test";
import assert from "node:assert/strict";
import { RecoveryTemplateLifecycleUseCase } from "./recovery-template-lifecycle.use-case.js";
import type { RecoveryLifecycleRepository, RecoveryLifecycleRecord } from "../../domain/ports/recovery-template-lifecycle.port.js";
import type { WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { TemplateSubmissionPort } from "../../domain/ports/template-submission.port.js";

function fixture(options: { status?: string; account?: string; changedConnection?: boolean; revision?: number; claimed?: boolean } = {}) {
  const version = { revision: 1, body: "Olá {{buyerName}}, retome {{link}}", metaTemplateBody: "Olá {{1}}, retome {{2}}", metaVariableMap: { "1": "buyerName", "2": "link" }, metaCategory: "MARKETING", metaLanguage: "pt_BR", contentSid: "zyon_approved_v1", wabaId: "123456789" };
  const row = { id: "row", merchantId: "merchant", type: "cart_recovery", channel: "whatsapp", body: "Nova versão {{link}}", metaRevision: options.revision ?? 2, metaStatus: "rejected", metaClaimToken: options.claimed ? "claim" : null, metaApprovedVersions: [version] } as unknown as RecoveryLifecycleRecord;
  const restored: unknown[] = [], checks: unknown[] = [];
  let reads = 0;
  const repo = { ensure: async () => {}, read: async () => ({ whatsapp: row, email: { subject: "Retome", body: "{{link}}" } }), restore: async (...args: unknown[]) => { restored.push(args); } } as unknown as RecoveryLifecycleRepository;
  const configs = { findByMerchantId: async () => ({ merchantId: "merchant", enabled: true, status: "ACTIVE", provider: "META_CLOUD", credentials: { accessToken: "test-token", phoneNumberId: "987654321", wabaId: options.changedConnection && ++reads > 1 ? "999999999" : options.account ?? "123456789" } }) } as unknown as WhatsAppConfigRepository;
  const submission = { syncStatus: async (...args: unknown[]) => { checks.push(args); return { contentSid: version.contentSid, status: options.status ?? "approved" }; } } as unknown as TemplateSubmissionPort;
  return { service: new RecoveryTemplateLifecycleUseCase(repo, submission, configs), restored, checks, version };
}
test("rollback checks exact content, language and current account before restoring", async () => {
  const h = fixture();
  await h.service.restore("merchant", "cart_recovery", 1, 2);
  assert.deepEqual(h.checks, [["merchant", h.version.contentSid, { language: "pt_BR", body: h.version.metaTemplateBody }]]);
  assert.equal(h.restored.length, 1);
});
for (const status of ["rejected", "paused", "disabled", "unknown", "submitted"]) {
  test(`rollback refuses a previous template now ${status}`, async () => {
    const h = fixture({ status });
    await assert.rejects(h.service.restore("merchant", "cart_recovery", 1, 2), /previous_template_not_approved/);
    assert.equal(h.restored.length, 0);
  });
}
test("rollback cannot cross accounts or a connection change during verification", async () => {
  for (const options of [{ account: "999999999" }, { changedConnection: true }]) {
    const h = fixture(options);
    await assert.rejects(h.service.restore("merchant", "cart_recovery", 1, 2), /template_(account_mismatch|connection_changed)/);
    assert.equal(h.restored.length, 0);
  }
});
test("stale forms and active monitor claims cannot restore", async () => {
  for (const options of [{ revision: 3 }, { claimed: true }]) {
    const h = fixture(options);
    await assert.rejects(h.service.restore("merchant", "cart_recovery", 1, 2), /template_revision_conflict/);
    assert.equal(h.checks.length + h.restored.length, 0);
  }
});
