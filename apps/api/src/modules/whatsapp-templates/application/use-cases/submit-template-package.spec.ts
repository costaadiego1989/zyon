import test from "node:test";
import assert from "node:assert/strict";
import { SubmitTemplatePackageUseCase } from "./submit-template-package.use-case.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";
// Every pre-existing default still registers; only the new on-demand purpose is excluded.
const defaultTypes: readonly string[] = WHATSAPP_TEMPLATE_TYPES.filter(type => type !== "buyer_whatsapp_link_otp");

test("connection registers every template with Meta instead of leaving drafts for the monitor", async () => {
  const submitted: string[] = [];
  const lifecycle = {
    async submit(_merchantId: string, type: string) {
      submitted.push(type);
      return { metaStatus: type === "loyalty" ? "approved" : "submitted", twilioContentSid: `zyon_${type}` };
    },
  } as any;

  const result = await new SubmitTemplatePackageUseCase(lifecycle).execute("m1");
  assert.deepEqual(submitted, [...defaultTypes]);
  assert.equal(result.submitted, defaultTypes.length - 1);
  assert.equal(result.skipped, 1);
  assert.equal(submitted.includes("buyer_whatsapp_link_otp"), false);
  assert.equal(submitted.includes("checkout_otp"), true);
  assert.equal(result.queued, 0);
  assert.equal(result.failed, 0);
});

test("one registration failure does not block other notification scenarios", async () => {
  const submitted: string[] = [];
  const lifecycle = {
    async submit(_merchantId: string, type: string) {
      submitted.push(type);
      if (type === "nps") throw new Error("meta_http_400");
      return { metaStatus: "submitted", twilioContentSid: `zyon_${type}` };
    },
  } as any;

  const result = await new SubmitTemplatePackageUseCase(lifecycle).execute("m1");
  assert.equal(submitted.length, defaultTypes.length);
  assert.equal(result.submitted, defaultTypes.length - 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.perType.find(item => item.type === "nps"), {
    type: "nps", status: "draft", reason: "meta_http_400",
  });
});
