import test from "node:test";
import assert from "node:assert/strict";
import { Registry } from "prom-client";
import { FiscalObservability } from "./fiscal-observability.js";
import { safelyObserveFiscal } from "../domain/fiscal-observation.port.js";

const scope = { provider: "focus" as const, environment: "homologation" as const };
function fixture() {
  const registry = new Registry(), logs: object[] = [];
  const observer = new FiscalObservability(registry, { info(value: object) { logs.push(value); } });
  return { registry, logs, observer };
}
async function values(f: ReturnType<typeof fixture>, name: string) {
  return (await f.registry.getSingleMetric(name)!.get()).values;
}
test("FISCAL-63 authorized and rejected document outcomes have independent counters", async () => {
  const f = fixture();
  f.observer.transition({ ...scope, previousState: "processing", state: "authorized" });
  f.observer.transition({ ...scope, previousState: "processing", state: "rejected" });
  const rows = await values(f, "fiscal_documents_total");
  assert.deepEqual(rows.map(r => [r.labels.outcome, r.value]), [["authorized", 1], ["rejected", 1]]);
});
test("FISCAL-63 reconciliation is distinct from a rejected or authorized note", async () => {
  const f = fixture();
  f.observer.transition({ ...scope, previousState: "processing", state: "reconciliation_required" });
  const rows = await values(f, "fiscal_documents_total");
  assert.equal(rows.length, 1); assert.equal(rows[0]!.labels.outcome, "reconciliation_required");
});
test("FISCAL-63 repeated persisted state and ordinary queued work do not count new document outcomes", async () => {
  const f = fixture();
  f.observer.transition({ ...scope, previousState: "authorized", state: "authorized" });
  f.observer.transition({ ...scope, previousState: "queued", state: "processing" });
  assert.equal((await values(f, "fiscal_documents_total")).length, 0);
});
test("FISCAL-63 stock pending does not turn an authorized invoice into rejection", async () => {
  const f = fixture();
  f.observer.transition({ ...scope, previousState: "processing", state: "authorized", reasonCode: "fiscal_stock_evidence_pending" });
  f.observer.transition({ ...scope, previousState: "authorized", state: "authorized", previousReasonCode: "fiscal_stock_evidence_pending", reasonCode: "fiscal_stock_evidence_pending" });
  assert.equal((await values(f, "fiscal_documents_total"))[0]!.labels.outcome, "authorized");
  assert.equal((await values(f, "fiscal_stock_total"))[0]!.value, 1);
});
test("FISCAL-63 confirmed stock evidence and committed release are separate outcomes", async () => {
  const f = fixture();
  f.observer.stock({ ...scope, outcome: "evidence_confirmed" });
  f.observer.stock({ ...scope, outcome: "released" });
  assert.deepEqual((await values(f, "fiscal_stock_total")).map(r => r.labels.outcome), ["evidence_confirmed", "released"]);
  assert.equal((await values(f, "fiscal_documents_total")).length, 0);
});
test("FISCAL-63 each channel and transport retain independent accepted delivered failed and unknown outcomes", async () => {
  const f = fixture();
  for (const outcome of ["accepted", "delivered", "failed", "delivery_unknown"] as const)
    f.observer.delivery({ ...scope, channel: "email", transport: "resend", outcome });
  f.observer.delivery({ ...scope, channel: "whatsapp", transport: "meta", outcome: "blocked" });
  assert.equal((await values(f, "fiscal_deliveries_total")).length, 5);
  assert.equal((await values(f, "fiscal_documents_total")).length, 0);
});
test("FISCAL-61 diagnostic and metric labels exclude unexpected tax payload account and receipt properties", async () => {
  const f = fixture(), secret = "private-do-not-log";
  f.observer.transition({ ...scope, previousState: "processing", state: "rejected", reasonCode: secret, accountId: secret, fiscalPayload: secret, privateReceipt: secret } as any);
  const output = JSON.stringify(f.logs) + await f.registry.metrics();
  assert.equal(output.includes(secret), false);
  assert.deepEqual(Object.keys(f.logs[0]!).sort(), ["code", "environment", "outcome", "provider"]);
  assert.equal(output.includes("merchant_id"), false);
});
test("FISCAL-61 unknown provider environment channel and outcome never become high cardinality labels", async () => {
  const f = fixture();
  f.observer.transition({ ...scope, provider: "private-account", previousState: "processing", state: "rejected" } as any);
  f.observer.stock({ ...scope, environment: "private-environment", outcome: "released" } as any);
  f.observer.delivery({ ...scope, channel: "private-channel", transport: "meta", outcome: "delivered" } as any);
  f.observer.delivery({ ...scope, channel: "email", transport: "resend", outcome: "private-outcome" } as any);
  assert.equal(f.logs.length, 0);
  assert.equal((await f.registry.metrics()).includes("private-"), false);
});
test("FISCAL-63 optional diagnostic failures cannot change committed business results", () => {
  const observer = { transition() { throw new Error("private-log-error"); } } as any;
  assert.doesNotThrow(() => safelyObserveFiscal(() => observer.transition({ ...scope, state: "authorized" })));
  const f = new FiscalObservability(new Registry(), { info() { throw new Error("private-log-error"); } });
  assert.doesNotThrow(() => f.transition({ ...scope, previousState: "processing", state: "authorized" }));
});
