import test from "node:test";
import assert from "node:assert/strict";
import { requirePublishedFiscalBaselineTarget } from "./fiscal-published-baseline.fixture.js";

const local = "postgresql://fiscal:fiscal_local_only_20261114@127.0.0.1:25432/zyon_fiscal";
const ci = "postgresql://fiscal:fiscal_ci_local_only@127.0.0.1:5432/zyon_fiscal";

test("FISCAL-64 dedicated baseline accepts only the exact local or GitHub executor target", () => {
  for (const flag of ["", "false", "TRUE", "1"]) {
    const target = requirePublishedFiscalBaselineTarget(local, flag);
    assert.equal(target.toString(), local);
    assert.equal(target.hostname, "127.0.0.1");
    assert.equal(target.port, "25432");
    assert.equal(target.pathname, "/zyon_fiscal");
  }
  const target = requirePublishedFiscalBaselineTarget(ci, "true");
  assert.equal(target.toString(), ci);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "5432");
  assert.equal(target.pathname, "/zyon_fiscal");
});

test("FISCAL-64 exact fixture targets reject cross-executor ports credentials and unrecognized flags", () => {
  for (const [value, flag] of [[local, "true"], [ci, "false"], [ci, "TRUE"], [ci, "1"],
    [ci.replace(":5432/", ":25432/"), "true"], [local.replace(":25432/", ":5432/"), "false"],
    [ci.replace("fiscal_ci_local_only@", "different@"), "true"], [ci.replace("//fiscal:", "//other:"), "true"]]) {
    assert.throws(() => requirePublishedFiscalBaselineTarget(value, flag), /fiscal_baseline_requires_exact_local_database/);
  }
});

test("FISCAL-64 exact baseline guard rejects remote legacy and URL override targets in both executors", () => {
  for (const [base, flag] of [[local, "false"], [ci, "true"]]) {
    for (const value of [base.replace("127.0.0.1", "remote.example"), base.replace("zyon_fiscal", "aacp_test"),
      base + "?schema=public", base + "?host=remote.example", base + "?sslmode=require", base + "#other"]) {
      assert.throws(() => requirePublishedFiscalBaselineTarget(value, flag), /fiscal_(?:fixture_requires_isolated_local_database|baseline_requires_exact_local_database)/);
    }
  }
});
