import assert from "node:assert/strict";
import test from "node:test";
import { beginHumanHandoff, captureAiTurn, isCurrentAiTurn, type HandoffState } from "../../domain/services/whatsapp-handoff-state.js";

const scope = { merchantId: "synthetic-a", configId: "synthetic-config", whatsappSessionId: "synthetic-session" };
const initial: HandoffState = { ...scope, id: "synthetic-binding", mode: "ai", epoch: 0, ticketId: null, assignedOperatorId: null };

test("T48", async t => {
  await t.test("requesting human invalidates a captured turn without changing session lifecycle", () => {
    const turn = captureAiTurn(initial, scope);
    const requested = beginHumanHandoff(initial, scope, "synthetic-ticket", 0);
    assert.deepEqual(requested.state, { ...initial, mode: "waiting_human", ticketId: "synthetic-ticket", epoch: 1 });
    assert.equal(requested.changed, true);
    assert.equal(isCurrentAiTurn(requested.state, turn), false);
    assert.deepEqual(initial, { ...scope, id: "synthetic-binding", mode: "ai", epoch: 0, ticketId: null, assignedOperatorId: null });
  });
  await t.test("same-ticket retry is idempotent while a different ticket cannot replace the active case", () => {
    const waiting = beginHumanHandoff(initial, scope, "synthetic-ticket", 0).state;
    assert.deepEqual(beginHumanHandoff(waiting, scope, "synthetic-ticket", 0), { state: waiting, changed: false });
    assert.throws(() => beginHumanHandoff(waiting, scope, "other-ticket", 1), /handoff_already_active/);
    assert.equal(waiting.epoch, 1);
  });
  await t.test("scope, stale version and malformed snapshots cannot authorize a transition", () => {
    for (const key of ["merchantId", "configId", "whatsappSessionId"] as const) {
      assert.throws(() => beginHumanHandoff(initial, { ...scope, [key]: "foreign" }, "synthetic-ticket", 0), /handoff_scope_mismatch/);
    }
    assert.throws(() => beginHumanHandoff(initial, scope, "synthetic-ticket", 1), /handoff_epoch_conflict/);
    assert.throws(() => beginHumanHandoff({ ...initial, epoch: -1 }, scope, "synthetic-ticket", 0), /handoff_invalid_state/);
    assert.throws(() => beginHumanHandoff({ ...initial, epoch: 2_147_483_647 }, scope, "synthetic-ticket", 2_147_483_647), /handoff_epoch_exhausted/);
  });
  await t.test("captured AI authorization belongs to one binding/config/session/epoch", () => {
    const turn = captureAiTurn(initial, scope);
    assert.equal(isCurrentAiTurn(initial, turn), true);
    for (const key of ["merchantId", "configId", "whatsappSessionId", "id"] as const) assert.equal(isCurrentAiTurn({ ...initial, [key]: "foreign" }, turn), false);
    assert.equal(isCurrentAiTurn({ ...initial, epoch: 1 }, turn), false);
    assert.throws(() => captureAiTurn(beginHumanHandoff(initial, scope, "synthetic-ticket", 0).state, scope), /handoff_ai_paused/);
  });
});
