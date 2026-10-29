import test from "node:test";
import assert from "node:assert/strict";
import { SupportSettingsEntity } from "./support-settings.entity.js";

const faqItem = (id: string, question = "How do I track my order?", answer = "Use the tracking link from the email.") => ({
  id,
  question,
  answer
});

test("SupportSettingsEntity.createDefault produces empty faq list with current timestamp", () => {
  const entity = SupportSettingsEntity.createDefault("mrc_1");
  const snapshot = entity.snapshot();

  assert.equal(snapshot.merchantId, "mrc_1");
  assert.deepEqual(snapshot.faqItems, []);
  assert.equal(typeof snapshot.updatedAt, "string");
  assert.ok(Date.parse(snapshot.updatedAt));
});

test("SupportSettingsEntity.rehydrate exposes existing settings via snapshot", () => {
  const entity = SupportSettingsEntity.rehydrate({
    merchantId: "mrc_1",
    faqItems: [faqItem("faq_1")],
    updatedAt: "2026-07-01T00:00:00.000Z"
  });
  const snapshot = entity.snapshot();

  assert.equal(snapshot.merchantId, "mrc_1");
  assert.equal(snapshot.faqItems.length, 1);
  assert.equal(snapshot.updatedAt, "2026-07-01T00:00:00.000Z");
});

test("SupportSettingsEntity.update replaces faq items and refreshes updatedAt", async () => {
  const entity = SupportSettingsEntity.rehydrate({
    merchantId: "mrc_1",
    faqItems: [],
    updatedAt: "2026-07-01T00:00:00.000Z"
  });

  await new Promise((r) => setTimeout(r, 5));
  const updated = entity.update({ faqItems: [faqItem("faq_1"), faqItem("faq_2", "Posso devolver?", "Sim, em até 7 dias.")] });
  const snapshot = updated.snapshot();

  assert.equal(snapshot.faqItems.length, 2);
  assert.equal(snapshot.faqItems[0]?.id, "faq_1");
  assert.notEqual(snapshot.updatedAt, "2026-07-01T00:00:00.000Z");
});

test("SupportSettingsEntity.update returns a new instance (immutable)", () => {
  const entity = SupportSettingsEntity.rehydrate({
    merchantId: "mrc_1",
    faqItems: [faqItem("faq_1")],
    updatedAt: "2026-07-01T00:00:00.000Z"
  });
  const updated = entity.update({ faqItems: [] });

  assert.equal(entity.snapshot().faqItems.length, 1);
  assert.equal(updated.snapshot().faqItems.length, 0);
});

test("SupportSettingsEntity rejects more than 20 FAQ items", () => {
  const entity = SupportSettingsEntity.createDefault("mrc_1");
  const overflow = Array.from({ length: 21 }, (_, i) => faqItem(`faq_${i}`));

  assert.throws(
    () => entity.update({ faqItems: overflow }),
    /support_settings_invalid_faq_items/
  );
});

test("SupportSettingsEntity accepts exactly 20 FAQ items", () => {
  const entity = SupportSettingsEntity.createDefault("mrc_1");
  const exactly20 = Array.from({ length: 20 }, (_, i) => faqItem(`faq_${i}`));

  const updated = entity.update({ faqItems: exactly20 });
  assert.equal(updated.snapshot().faqItems.length, 20);
});

test("SupportSettingsEntity rejects FAQ items missing id, question, or answer", () => {
  const entity = SupportSettingsEntity.createDefault("mrc_1");

  assert.throws(
    () => entity.update({ faqItems: [{ id: "", question: "q", answer: "a" }] }),
    /support_settings_invalid_faq_items/
  );
  assert.throws(
    () => entity.update({ faqItems: [{ id: "faq_1", question: "", answer: "a" }] }),
    /support_settings_invalid_faq_items/
  );
  assert.throws(
    () => entity.update({ faqItems: [{ id: "faq_1", question: "q", answer: "" }] }),
    /support_settings_invalid_faq_items/
  );
  assert.throws(
    () => entity.update({ faqItems: [{ id: "faq_1", question: "   ", answer: "a" }] }),
    /support_settings_invalid_faq_items/
  );
  assert.throws(
    () => entity.update({ faqItems: [{ id: "faq_1", question: "q", answer: "   " }] }),
    /support_settings_invalid_faq_items/
  );
});

test("SupportSettingsEntity rejects FAQ items over individual length limits", () => {
  const entity = SupportSettingsEntity.createDefault("mrc_1");
  const longQuestion = "a".repeat(201);
  const longAnswer = "a".repeat(1001);

  assert.throws(
    () => entity.update({ faqItems: [{ id: "faq_1", question: longQuestion, answer: "a" }] }),
    /support_settings_invalid_faq_items/
  );
  assert.throws(
    () => entity.update({ faqItems: [{ id: "faq_1", question: "q", answer: longAnswer }] }),
    /support_settings_invalid_faq_items/
  );

  // Acceptable at the boundary
  const okQuestion = "a".repeat(200);
  const okAnswer = "a".repeat(1000);
  const updated = entity.update({ faqItems: [{ id: "faq_1", question: okQuestion, answer: okAnswer }] });
  assert.equal(updated.snapshot().faqItems.length, 1);
});

test("SupportSettingsEntity.snapshot returns a defensive copy of faqItems", () => {
  const entity = SupportSettingsEntity.rehydrate({
    merchantId: "mrc_1",
    faqItems: [faqItem("faq_1")],
    updatedAt: "2026-07-01T00:00:00.000Z"
  });

  const snapshot = entity.snapshot();
  (snapshot.faqItems as { id?: string }[]).pop();
  assert.equal(entity.snapshot().faqItems.length, 1);
});
