import assert from "node:assert/strict";
import test from "node:test";
import { claimHumanHandoff, type HandoffState } from "./whatsapp-handoff-state.js";

const scope = { merchantId: "tenant", configId: "config", whatsappSessionId: "thread" };
const waiting = (): HandoffState => ({ id: "binding", ...scope, mode: "waiting_human", epoch: 1,
  ticketId: "ticket", assignedOperatorId: null });

test("T52 exact waiting case transitions to one immutable human claim", () => {
  const current = Object.freeze(waiting());
  const result = claimHumanHandoff(current, scope, "ticket", 1, "operator");
  assert.deepEqual(result, { changed: true, state: { ...current, mode: "human", epoch: 2, assignedOperatorId: "operator" } });
  assert.deepEqual(current, waiting()); assert.equal(Object.isFrozen(result.state), true);
});

test("T52 same operator can replay only the original or current epoch", () => {
  const current = claimHumanHandoff(waiting(), scope, "ticket", 1, "operator").state;
  for (const epoch of [1, 2]) assert.deepEqual(claimHumanHandoff(current, scope, "ticket", epoch, "operator"),
    { state: current, changed: false });
  for (const epoch of [0, 3, 99]) assert.throws(() => claimHumanHandoff(current, scope, "ticket", epoch, "operator"),
    /handoff_epoch_conflict/);
});

test("T52 another operator cannot take an already claimed case", () => {
  const current = claimHumanHandoff(waiting(), scope, "ticket", 1, "first").state;
  assert.throws(() => claimHumanHandoff(current, scope, "ticket", 2, "second"), /handoff_claimed/);
  assert.equal(current.assignedOperatorId, "first"); assert.equal(current.epoch, 2);
});

test("T52 merchant config and thread are independent scope fences", () => {
  for (const field of ["merchantId", "configId", "whatsappSessionId"] as const)
    assert.throws(() => claimHumanHandoff(waiting(), { ...scope, [field]: "foreign" }, "ticket", 1, "operator"),
      /handoff_scope_mismatch/);
});

test("T52 another or absent ticket cannot become the active claim", () => {
  for (const ticket of ["foreign", ""]) assert.throws(() => claimHumanHandoff(waiting(), scope, ticket, 1, "operator"),
    /handoff_ticket_mismatch/);
  assert.deepEqual(waiting(), { id: "binding", ...scope, mode: "waiting_human", epoch: 1, ticketId: "ticket", assignedOperatorId: null });
});

test("T52 stale future fractional and overflow epochs never authorize a claim", () => {
  for (const epoch of [0, 2, -1, 1.5, Number.NaN, 2_147_483_648])
    assert.throws(() => claimHumanHandoff(waiting(), scope, "ticket", epoch, "operator"), /handoff_epoch_conflict/);
});

test("T52 claim requires a nonempty bounded operator identity", () => {
  for (const operator of ["", " ", "x".repeat(192)]) assert.throws(() => claimHumanHandoff(waiting(), scope, "ticket", 1, operator),
    /handoff_operator_required/);
});

test("T52 AI mode cannot be claimed as a waiting human case", () => {
  assert.throws(() => claimHumanHandoff({ ...waiting(), mode: "ai" }, scope, "ticket", 1, "operator"), /handoff_not_waiting/);
});

test("T52 exhausted epoch cannot wrap and old state stays intact", () => {
  const current = Object.freeze({ ...waiting(), epoch: 2_147_483_647 });
  assert.throws(() => claimHumanHandoff(current, scope, "ticket", 2_147_483_647, "operator"), /handoff_epoch_exhausted/);
  assert.equal(current.epoch, 2_147_483_647); assert.equal(current.mode, "waiting_human");
});

test("T52 malformed persisted human state cannot acquire claim authority", () => {
  assert.throws(() => claimHumanHandoff({ ...waiting(), mode: "human" }, scope, "ticket", 1, "operator"), /handoff_invalid_state/);
});
