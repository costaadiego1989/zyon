import test from "node:test";
import assert from "node:assert/strict";
import { SubmitTemplatePackageUseCase } from "./submit-template-package.use-case.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";
test("connection durably queues every scenario including recovery without overwriting merchant content", async () => {
  const ensured: string[] = [];
  const lifecycle = { async ensure(_m: string, type: string) { ensured.push(type); }, async record(_m: string, type: string) { return { metaStatus: type === "loyalty" ? "approved" : "draft" }; } } as any;
  const result = await new SubmitTemplatePackageUseCase(lifecycle).execute("m1");
  assert.deepEqual(ensured, [...WHATSAPP_TEMPLATE_TYPES]); assert.equal(result.skipped, 1);
  assert.equal(result.queued, WHATSAPP_TEMPLATE_TYPES.length - 1); assert.equal(result.submitted, 0);
});
test("one failed seed does not stop the other scenarios", async () => {
  const lifecycle = { async ensure(_m: string, type: string) { if(type === "nps")throw new Error("db"); }, async record() { return { metaStatus: "draft" }; } } as any;
  const result = await new SubmitTemplatePackageUseCase(lifecycle).execute("m1");assert.equal(result.failed, 1);assert.equal(result.queued, WHATSAPP_TEMPLATE_TYPES.length - 1);
});
