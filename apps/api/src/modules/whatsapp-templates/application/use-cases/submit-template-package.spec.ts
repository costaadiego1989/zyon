import test from "node:test";
import assert from "node:assert/strict";
import { SubmitTemplatePackageUseCase } from "./submit-template-package.use-case.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";

function harness(opts: { existing?: Record<string, any>; submitStatus?: string; throwOn?: string }) {
  const upserts: any[] = [];
  const metaUpdates: any[] = [];
  const submitted: any[] = [];
  const store: Record<string, any> = { ...(opts.existing ?? {}) };

  const templates = {
    async findByMerchantAndType(_m: string, type: string) {
      return store[type] ?? null;
    },
    async upsert(i: any) {
      upserts.push(i);
      store[i.type] = { ...store[i.type], ...i, twilioContentSid: store[i.type]?.twilioContentSid };
      return store[i.type];
    },
    async updateMeta(i: any) {
      metaUpdates.push(i);
      store[i.type] = { ...store[i.type], ...i };
      return store[i.type];
    },
  } as any;

  const submission = {
    async createAndSubmit(i: any) {
      if (opts.throwOn && i.friendlyName.includes(opts.throwOn)) throw new Error("boom");
      submitted.push(i);
      return { contentSid: "HX_" + i.friendlyName, status: opts.submitStatus ?? "submitted" };
    },
    async syncStatus() {
      return { contentSid: "", status: "unknown" as const };
    },
  } as any;

  return { uc: new SubmitTemplatePackageUseCase(templates, submission), upserts, metaUpdates, submitted };
}

test("submits the full catalog for a fresh merchant", async () => {
  const h = harness({});
  const r = await h.uc.execute("m1", "Loja X");
  assert.equal(r.submitted, WHATSAPP_TEMPLATE_TYPES.length);
  assert.equal(r.failed, 0);
  assert.equal(h.submitted.length, WHATSAPP_TEMPLATE_TYPES.length);
  // each type got a meta update with a contentSid + submitted status
  assert.ok(h.metaUpdates.every((u) => u.metaStatus === "submitted" && u.twilioContentSid));
});

test("idempotent: skips types already submitted with a contentSid", async () => {
  const existing = {
    follow_up: { twilioContentSid: "HXexisting", metaStatus: "approved" },
  };
  const h = harness({ existing });
  const r = await h.uc.execute("m1");
  assert.equal(r.skipped, 1);
  assert.equal(r.submitted, WHATSAPP_TEMPLATE_TYPES.length - 1);
  assert.ok(!h.submitted.some((s) => s.friendlyName.includes("follow_up")));
});

test("never throws on submission failure; counts it as failed", async () => {
  const h = harness({ throwOn: "nps" });
  const r = await h.uc.execute("m1");
  assert.equal(r.failed >= 1, true);
  assert.equal(r.submitted, WHATSAPP_TEMPLATE_TYPES.length - 1);
});

test("draft submission status counts as failed (not submitted)", async () => {
  const h = harness({ submitStatus: "draft" });
  const r = await h.uc.execute("m1");
  assert.equal(r.submitted, 0);
  assert.equal(r.failed, WHATSAPP_TEMPLATE_TYPES.length);
});
