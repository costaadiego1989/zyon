import test from "node:test";
import assert from "node:assert/strict";
import { UnprocessableEntityException } from "@nestjs/common";
import { UpdateSupportSettingsUseCase } from "./update-support-settings.use-case.js";
import { InMemorySupportSettingsRepository } from "../infrastructure/in-memory-support-settings.repository.js";

const faq = (id: string) => ({ id, question: "Question?", answer: "Answer." });

test("UpdateSupportSettingsUseCase persists new settings on first write", async () => {
  const repository = new InMemorySupportSettingsRepository();
  const useCase = new UpdateSupportSettingsUseCase(repository);

  const saved = await useCase.execute("mrc_1", { faqItems: [faq("faq_1")] });

  assert.equal(saved.merchantId, "mrc_1");
  assert.equal(saved.faqItems.length, 1);
  assert.equal((await repository.get("mrc_1"))?.faqItems.length, 1);
});

test("UpdateSupportSettingsUseCase updates existing settings", async () => {
  const repository = new InMemorySupportSettingsRepository();
  await repository.save({
    merchantId: "mrc_1",
    faqItems: [faq("faq_1")],
    updatedAt: "2026-07-01T00:00:00.000Z"
  });
  const useCase = new UpdateSupportSettingsUseCase(repository);

  const saved = await useCase.execute("mrc_1", { faqItems: [faq("faq_1"), faq("faq_2")] });

  assert.equal(saved.faqItems.length, 2);
});

test("UpdateSupportSettingsUseCase translates entity validation errors to HTTP 422", async () => {
  const repository = new InMemorySupportSettingsRepository();
  const useCase = new UpdateSupportSettingsUseCase(repository);

  // Empty id triggers validation error
  await assert.rejects(
    () =>
      useCase.execute("mrc_1", {
        faqItems: [{ id: "", question: "q", answer: "a" }]
      }),
    (err: unknown) => err instanceof UnprocessableEntityException
  );

  // Missing question content (whitespace only)
  await assert.rejects(
    () =>
      useCase.execute("mrc_1", {
        faqItems: [{ id: "faq_1", question: "   ", answer: "a" }]
      }),
    (err: unknown) => err instanceof UnprocessableEntityException
  );

  // Repository must remain untouched when validation fails.
  assert.equal(await repository.get("mrc_1"), null);
});

test("UpdateSupportSettingsUseCase rethrows non-validation errors", async () => {
  const repository = new InMemorySupportSettingsRepository();
  await repository.save({
    merchantId: "mrc_1",
    faqItems: [faq("faq_1")],
    updatedAt: "2026-07-01T00:00:00.000Z"
  });
  const useCase = new UpdateSupportSettingsUseCase(repository);

  // Overwriting with a payload that violates entity bounds surfaces as 422
  // not as an unhandled error.
  await assert.rejects(
    () =>
      useCase.execute("mrc_1", {
        faqItems: Array.from({ length: 21 }, (_, i) => faq(`faq_${i}`))
      }),
    UnprocessableEntityException
  );
});
