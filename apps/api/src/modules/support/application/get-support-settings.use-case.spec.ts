import test from "node:test";
import assert from "node:assert/strict";
import { GetSupportSettingsUseCase } from "./get-support-settings.use-case.js";
import { InMemorySupportSettingsRepository } from "../infrastructure/in-memory-support-settings.repository.js";

test("GetSupportSettingsUseCase returns stored settings when present", async () => {
  const repository = new InMemorySupportSettingsRepository();
  await repository.save({
    merchantId: "mrc_1",
    faqItems: [{ id: "faq_1", question: "Q?", answer: "A." }],
    updatedAt: "2026-07-01T00:00:00.000Z"
  });

  const useCase = new GetSupportSettingsUseCase(repository);
  const result = await useCase.execute("mrc_1");

  assert.equal(result.merchantId, "mrc_1");
  assert.equal(result.faqItems.length, 1);
  assert.equal(result.updatedAt, "2026-07-01T00:00:00.000Z");
});

test("GetSupportSettingsUseCase returns in-memory default without persisting it", async () => {
  const repository = new InMemorySupportSettingsRepository();
  const useCase = new GetSupportSettingsUseCase(repository);

  const result = await useCase.execute("mrc_unknown");

  assert.equal(result.merchantId, "mrc_unknown");
  assert.deepEqual(result.faqItems, []);
  // Read-on-default must NOT trigger persistence (P1 bug fix).
  assert.equal(await repository.get("mrc_unknown"), null);
});

test("GetSupportSettingsUseCase isolates defaults per merchant", async () => {
  const repository = new InMemorySupportSettingsRepository();
  const useCase = new GetSupportSettingsUseCase(repository);

  const first = await useCase.execute("mrc_a");
  const second = await useCase.execute("mrc_b");

  assert.equal(first.merchantId, "mrc_a");
  assert.equal(second.merchantId, "mrc_b");
});
