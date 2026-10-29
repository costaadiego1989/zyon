import test from "node:test";
import assert from "node:assert/strict";
import { InMemorySupportSettingsRepository } from "./in-memory-support-settings.repository.js";
import type { SupportSettings } from "@zyon/shared-types";

const settings = (merchantId: string): SupportSettings => ({
  merchantId,
  faqItems: [{ id: "faq_1", question: "Q?", answer: "A." }],
  updatedAt: "2026-07-01T00:00:00.000Z"
});

test("InMemorySupportSettingsRepository save/get round-trips settings", async () => {
  const repo = new InMemorySupportSettingsRepository();
  const saved = await repo.save(settings("mrc_1"));

  assert.equal(saved.merchantId, "mrc_1");
  assert.equal(saved.faqItems.length, 1);

  const got = await repo.get("mrc_1");
  assert.deepEqual(got, saved);
});

test("InMemorySupportSettingsRepository get returns null for missing merchant", async () => {
  const repo = new InMemorySupportSettingsRepository();
  assert.equal(await repo.get("mrc_unknown"), null);
});

test("InMemorySupportSettingsRepository isolates merchants", async () => {
  const repo = new InMemorySupportSettingsRepository();
  await repo.save(settings("mrc_1"));
  await repo.save(settings("mrc_2"));

  const got1 = await repo.get("mrc_1");
  const got2 = await repo.get("mrc_2");

  assert.equal(got1?.merchantId, "mrc_1");
  assert.equal(got2?.merchantId, "mrc_2");
});

test("InMemorySupportSettingsRepository save overwrites existing settings", async () => {
  const repo = new InMemorySupportSettingsRepository();
  await repo.save(settings("mrc_1"));
  await repo.save({
    merchantId: "mrc_1",
    faqItems: [{ id: "faq_2", question: "Q2?", answer: "A2." }, { id: "faq_3", question: "Q3?", answer: "A3." }],
    updatedAt: "2026-07-02T00:00:00.000Z"
  });

  const got = await repo.get("mrc_1");
  assert.equal(got?.faqItems.length, 2);
  assert.equal(got?.updatedAt, "2026-07-02T00:00:00.000Z");
});

test("InMemorySupportSettingsRepository delete removes merchant settings", async () => {
  const repo = new InMemorySupportSettingsRepository();
  await repo.save(settings("mrc_1"));

  await repo.delete("mrc_1");

  assert.equal(await repo.get("mrc_1"), null);
});

test("InMemorySupportSettingsRepository save returns a separate object reference", async () => {
  const repo = new InMemorySupportSettingsRepository();
  const original = settings("mrc_1");
  const saved = await repo.save(original);

  // Mutate the returned top-level object
  (saved as { merchantId: string }).merchantId = "MUTATED";

  const got = await repo.get("mrc_1");
  assert.equal(got?.merchantId, "mrc_1"); // store is unaffected
});
