import test from "node:test";
import assert from "node:assert/strict";
import { SubmitTemplatePackageUseCase } from "./submit-template-package.use-case.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";

test("connection registers every template with Meta instead of leaving drafts for the monitor", async () => {
  const submitted: string[] = [];
  const lifecycle = {
    async submit(_merchantId: string, type: string) {
      submitted.push(type);
      return { metaStatus: type === "loyalty" ? "approved" : "submitted", twilioContentSid: `zyon_${type}` };
    },
  } as any;

  const result = await new SubmitTemplatePackageUseCase(lifecycle).execute("m1");
  assert.deepEqual(submitted, [...WHATSAPP_TEMPLATE_TYPES]);
  assert.equal(result.submitted, WHATSAPP_TEMPLATE_TYPES.length - 1);
  assert.equal(result.skipped, 1);
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
  assert.equal(submitted.length, WHATSAPP_TEMPLATE_TYPES.length);
  assert.equal(result.submitted, WHATSAPP_TEMPLATE_TYPES.length - 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.perType.find(item => item.type === "nps"), {
    type: "nps", status: "draft", reason: "meta_http_400",
  });
});
