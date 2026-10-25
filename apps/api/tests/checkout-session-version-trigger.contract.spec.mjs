import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { installCheckoutSessionVersionTrigger } from "./checkout-session-version-trigger.mjs";

test("owned DB receives the exact deployment version trigger before inspection", async () => {
  const calls = [];
  await installCheckoutSessionVersionTrigger({ async sql(sql) { calls.push(sql); return sql.includes("SELECT count(*)") ? "1" : ""; } });
  assert.equal(calls[0], await readFile(new URL("../prisma/deploy-migrations/20260929020000_checkout_session_write_version/migration.sql", import.meta.url), "utf8"));
  assert.match(calls[1], /t\.tgenabled='O'/);
  assert.match(calls[1], /n\.nspname='public'/);
  const strategy = await readFile(new URL("../prisma/deploy-migrations/20260924230000_strategy_turn_completions/migration.sql", import.meta.url), "utf8");
  assert.ok(strategy.includes(calls[2]), "only_exact_original_strategy_sql_is_allowed");
  assert.match(calls[2], /ELSE NEW\.strategy_context_version := OLD\.strategy_context_version;/);
  assert.match(calls[3], /strategy_session_context_version_guard/);
  assert.equal(calls.length, 4);
});
test("a missing strategy guard is not covered by a passing persistence version guard", async () => {
  let calls = 0;
  await assert.rejects(installCheckoutSessionVersionTrigger({ async sql() { calls++; return calls === 2 ? "1" : "0"; } }), /actual_checkout_strategy_trigger_required/);
});
for (const result of ["0", "2", "", "01"]) test(`missing or ambiguous installed trigger fails closed (${JSON.stringify(result)})`, async () => {
  let calls = 0;
  await assert.rejects(installCheckoutSessionVersionTrigger({ async sql() { return ++calls === 2 ? result : ""; } }), /actual_checkout_version_trigger_required/);
});
test("installation error cannot fall back to schema-only fixtures", async () => {
  await assert.rejects(installCheckoutSessionVersionTrigger({ async sql() { throw new Error("synthetic_install_failure"); } }), /synthetic_install_failure/);
});
