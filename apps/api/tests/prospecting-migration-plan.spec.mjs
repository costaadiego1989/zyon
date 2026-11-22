import assert from "node:assert/strict";
import { test } from "node:test";
import { prospectingMigrationPlan } from "../scripts/prospecting-migration-plan.mjs";
const base = "postgresql://fixture:fixture@127.0.0.1:15438/prospecting_test";
test("production prospecting keeps the directory migration disabled with the module", async () => {
  assert.equal(await prospectingMigrationPlan({}), null);
  assert.equal(await prospectingMigrationPlan({ PROSPECTING_ENABLED: "false" }), null);
});
test("production prospecting normalizes disabled and enabled flags exactly like runtime", async () => {
  for (const value of ["", " ", " false ", "false"])
    assert.equal(await prospectingMigrationPlan({ PROSPECTING_ENABLED: value }), null);
  assert.deepEqual(await prospectingMigrationPlan({PROSPECTING_ENABLED:" true ",DATABASE_URL:base,PROSPECTING_DIRECTORY_DATABASE_URL:base+"?schema=company_directory"}),["migrate","deploy","--config","prisma.company-directory.config.ts"]);
});
test("production prospecting deploys its independent history in the same database", async () => {
  assert.deepEqual(await prospectingMigrationPlan({PROSPECTING_ENABLED:"true",DATABASE_URL:base+"?schema=public",PROSPECTING_DIRECTORY_DATABASE_URL:base+"?schema=company_directory"}),["migrate","deploy","--config","prisma.company-directory.config.ts"]);
});
test("production prospecting refuses another database, server or public migration history", async () => {
  for (const url of [base+"_foreign?schema=company_directory",base.replace(":15438",":15439")+"?schema=company_directory",base+"?schema=public",base])
    await assert.rejects(()=>prospectingMigrationPlan({PROSPECTING_ENABLED:"true",DATABASE_URL:base,PROSPECTING_DIRECTORY_DATABASE_URL:url}),/database_mismatch|schema_invalid/);
  await assert.rejects(()=>prospectingMigrationPlan({PROSPECTING_ENABLED:"true",DATABASE_URL:base}),/database_required/);
  await assert.rejects(()=>prospectingMigrationPlan({PROSPECTING_ENABLED:"yes"}),/config_invalid/);
});
