import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { CashbackConfigurationWrite, CashbackDraft } from "@zyon/shared-types";
import { CashbackService } from "../application/cashback.service.js";
import { cashbackConfigurationFixture, configurationRules as rules } from "./__tests__/cashback-configuration.fixture.js";

let f: Awaited<ReturnType<typeof cashbackConfigurationFixture>>;
before(async () => { f = await cashbackConfigurationFixture(); });
beforeEach(async () => { await f.reset(); });
after(async () => { await f?.close(); });
const command = (expectedRevision: string, idempotencyKey: string): CashbackConfigurationWrite => ({ expectedRevision, idempotencyKey });
const isConflict = (error: unknown) => error instanceof Error && error.message === "cashback_configuration_changed" && (error as { status?: number }).status === 409;

test("configuration revision is canonical, merchant-bound and opt-in for legacy internal reads", async () => {
  const first = await f.program(); const second = await f.program(); const other = await f.program("merchant-b");
  assert.match(first.configurationRevision!, /^[a-f0-9]{64}$/);
  assert.equal(first.configurationRevision, second.configurationRevision);
  assert.notEqual(first.configurationRevision, other.configurationRevision);
  assert.deepEqual(await f.service.getProgram("merchant-a"), { merchantId: "merchant-a", status: "disabled", draft: null, published: null, version: 0, updatedAt: null });
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_programs")).rows[0].n, 0);
});

test("CBX-28 publication freezes exactly the persisted reviewed rules and actor in one version", async () => {
  const initial = await f.program();
  const draft = await f.service.saveDraft("merchant-a", rules, "owner-a", command(initial.configurationRevision!, "draft-one"));
  assert.equal(draft.status, "disabled"); assert.equal(draft.version, 0); assert.equal(draft.published, null);
  const published = await f.service.publishProgram("merchant-a", "owner-a", { requireCombination: true, command: command(draft.configurationRevision!, "publish-one") });
  assert.equal(published.status, "active"); assert.equal(published.version, 1);
  assert.deepEqual(published.draft, rules); assert.deepEqual(published.published, rules);
  assert.notEqual(published.configurationRevision, draft.configurationRevision);
  const rows = await f.db.query("SELECT version,rules,actor_id FROM cashback_rule_versions WHERE merchant_id=$1", ["merchant-a"]);
  assert.deepEqual(rows.rows, [{ version: 1, rules, actor_id: "owner-a" }]);
  assert.deepEqual((await f.program()).published, rules);
});

test("stale reviewed draft cannot publish and leaves version history and receipts unchanged", async () => {
  const initial = await f.program();
  const reviewed = await f.service.saveDraft("merchant-a", rules, "owner-a", command(initial.configurationRevision!, "draft-one"));
  const changedRules = { ...rules, earnRateBps: 750 };
  const changed = await f.service.saveDraft("merchant-a", changedRules, "admin-b", command(reviewed.configurationRevision!, "draft-two"));
  await assert.rejects(f.service.publishProgram("merchant-a", "owner-a", { requireCombination: true, command: command(reviewed.configurationRevision!, "publish-stale") }), isConflict);
  assert.deepEqual(await f.program(), changed);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_rule_versions")).rows[0].n, 0);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts")).rows[0].n, 2);
});

test("CBX-31 replaying a saved draft after a newer edit returns its receipt without rewriting the draft", async () => {
  const initial = await f.program(); const input = command(initial.configurationRevision!, "same-operation");
  const saved = await f.service.saveDraft("merchant-a", { earnRateBps: 500 }, "owner-a", input);
  const later = await f.service.saveDraft("merchant-a", { earnRateBps: 700 }, "owner-a", command(saved.configurationRevision!, "later-operation"));
  const replay = await f.service.saveDraft("merchant-a", { earnRateBps: 500 }, "owner-a", input);
  assert.deepEqual(replay, saved); assert.deepEqual(await f.program(), later);
  const receipts = await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts");
  assert.equal(receipts.rows[0].n, 2);
  await assert.rejects(f.service.saveDraft("merchant-a", { earnRateBps: 600 }, "owner-a", input), /cashback_idempotency_input_mismatch/);
  assert.deepEqual(await f.program(), later);
});

test("concurrent writers sharing one review revision admit only one canonical change", async () => {
  const initial = await f.program(); const other = new CashbackService(f.repository);
  const results = await Promise.allSettled([
    f.service.saveDraft("merchant-a", { earnRateBps: 500 }, "owner-a", command(initial.configurationRevision!, "race-a")),
    other.saveDraft("merchant-a", { earnRateBps: 900 }, "admin-b", command(initial.configurationRevision!, "race-b")),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(isConflict(rejected.reason));
  const admitted = (results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<CashbackService["saveDraft"]>>>).value;
  assert.deepEqual(await f.program(), admitted);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts")).rows[0].n, 1);
});

test("partial nested combination preserves explicit false null and zero without inventing other rules", async () => {
  const initial = await f.program();
  const first = await f.service.saveDraft("merchant-a", { minimumEarnCents: 0, expiryDays: null, combination: { allowCoupons: false } }, "owner-a", { ...command(initial.configurationRevision!, "partial-one"), merge: true });
  assert.deepEqual(first.draft, { minimumEarnCents: 0, expiryDays: null, combination: { allowCoupons: false } });
  const next = await f.service.saveDraft("merchant-a", { combination: { allowAdvancedRules: true } }, "owner-a", { ...command(first.configurationRevision!, "partial-two"), merge: true });
  assert.deepEqual(next.draft, { minimumEarnCents: 0, expiryDays: null, combination: { allowCoupons: false, allowAdvancedRules: true } });
  assert.equal(next.status, "disabled"); assert.equal(next.version, 0); assert.equal(next.published, null);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_ledger_entries")).rows[0].n, 0);
});

test("editing an active program changes only the draft until another explicit publication", async () => {
  await f.service.saveDraft("merchant-a", rules, "owner-a"); await f.service.publishProgram("merchant-a", "owner-a");
  const initial = await f.program();
  const saved = await f.service.saveDraft("merchant-a", { earnRateBps: 800 }, "owner-a", { ...command(initial.configurationRevision!, "active-edit"), merge: true });
  assert.equal(saved.status, "active"); assert.equal(saved.version, 1); assert.deepEqual(saved.published, rules);
  assert.deepEqual(saved.draft, { ...rules, earnRateBps: 800 });
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_rule_versions")).rows[0].n, 1);
});

test("invalid partial choices never persist configuration or command receipts", async () => {
  const initial = await f.program();
  const invalid: unknown[] = [null, [], { earnRateBps: 0 }, { earnRateBps: 10001 }, { minimumEarnCents: -1 }, { minimumEarnCents: 0.5 }, { monthlyBudgetCents: 0 },
    { releaseTrigger: "tomorrow" }, { releaseDelayDays: 366 }, { expiryDays: 0 }, { maximumRedeemBps: 10000 }, { allowWithDiscounts: "yes" },
    { combination: { allowCoupons: "yes" } }, { combination: { limitMode: "unlimited" } }, { combination: { maximumCombinedDiscountBps: 10001 } },
    { combination: { maximumCombinedDiscountBps: null, maximumCombinedDiscountCents: null } }, { status: "active" }, { terms: "tiny" }, { combination: { unknown: true } }];
  for (const [index, value] of invalid.entries()) await assert.rejects(f.service.saveDraft("merchant-a", value as CashbackDraft, "owner-a", command(initial.configurationRevision!, `invalid-${index}`)));
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_programs")).rows[0].n, 0);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts")).rows[0].n, 0);
});

test("a published program without a draft remains the base for an explicit partial edit", async () => {
  await f.service.saveDraft("merchant-a", rules, "owner-a");
  await f.service.publishProgram("merchant-a", "owner-a");
  await f.db.query("UPDATE cashback_programs SET draft=NULL WHERE merchant_id=$1", ["merchant-a"]);
  const initial = await f.program();
  const edited = await f.service.saveDraft("merchant-a", { combination: { allowAdvancedRules: true } }, "owner-a",
    { ...command(initial.configurationRevision!, "published-base-edit"), merge: true });
  assert.deepEqual(edited.draft, { ...rules, combination: { ...rules.combination, allowAdvancedRules: true } });
  assert.deepEqual(edited.published, rules);
  assert.equal(edited.status, "active");
  assert.equal(edited.version, 1);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_rule_versions")).rows[0].n, 1);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_ledger_entries")).rows[0].n, 0);
});

test("configuration revisions and receipt namespaces cannot cross merchant or actor boundaries", async () => {
  const initial = await f.program();
  await assert.rejects(f.service.saveDraft("merchant-b", { earnRateBps: 500 }, "owner-a", command(initial.configurationRevision!, "tenant-forgery")), isConflict);
  assert.equal((await f.program("merchant-b")).draft, null);
  const first = await f.service.saveDraft("merchant-a", { earnRateBps: 500 }, "owner-a", command(initial.configurationRevision!, "same-key"));
  const second = await f.service.saveDraft("merchant-a", { earnRateBps: 700 }, "admin-b", command(first.configurationRevision!, "same-key"));
  assert.deepEqual(second.draft, { earnRateBps: 700 });
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts")).rows[0].n, 2);
});

test("a publication replay never increments the rule version again after a later draft save", async () => {
  const initial = await f.program(); const saved = await f.service.saveDraft("merchant-a", rules, "owner-a", command(initial.configurationRevision!, "draft"));
  const publish = { requireCombination: true, command: command(saved.configurationRevision!, "publish") };
  const first = await f.service.publishProgram("merchant-a", "owner-a", publish);
  const later = await f.service.saveDraft("merchant-a", { ...rules, earnRateBps: 600 }, "owner-a", command(first.configurationRevision!, "later"));
  assert.deepEqual(await f.service.publishProgram("merchant-a", "owner-a", publish), first);
  assert.deepEqual(await f.program(), later);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_rule_versions")).rows[0].n, 1);
});
