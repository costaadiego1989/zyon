import assert from "node:assert/strict";
import test from "node:test";
import type { StorefrontWriteAdmissionPort, StorefrontWriteAdmissionRequest } from "../../domain/ports/storefront-write-admission.port.js";
import type { StorefrontLocalCartEffectPort } from "../../domain/ports/storefront-local-cart-effect.port.js";
import type { StorefrontClaimedCartEffectRequest } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { ExecuteStorefrontLocalCartWrite } from "./execute-storefront-local-cart-write.js";

const requestId = "56f51c75-e1d5-4a84-9031-e616927707a0", claimToken = "28e16d88-f9f7-4605-8f9f-88ff96eebc95";
const effectId = "a5537938-7496-4ea4-94b4-ec872a418337";
const claim = () => ({ requestId, claimToken, claimGeneration: 1 as const });
const input = (): StorefrontWriteAdmissionRequest => ({
  scope: { merchantId: "merchant", conversationId: "conversation", cartId: "cart", principalId: "principal" },
  intent: { version: 1, message_id: "message", expected_revision: 0,
    command: { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 2 } } },
  fingerprint: { version: 1, bytes: new Uint8Array(32).fill(17) },
});
const proof = () => ({ kind: "effect_recorded", requestId, effectId, revision: 1 });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; };
type Options = { admitted?: unknown; outcome?: unknown; transition?: unknown;
  admit?: (value: StorefrontWriteAdmissionRequest) => Promise<unknown>;
  effect?: (value: StorefrontClaimedCartEffectRequest) => Promise<unknown>;
  mark?: (value: Parameters<StorefrontWriteAdmissionPort["markUnknown"]>[0]) => Promise<unknown> };
function fixture(options: Options = {}) {
  const calls: string[] = [], admissions: StorefrontWriteAdmissionRequest[] = [], effects: StorefrontClaimedCartEffectRequest[] = [];
  const marks: Parameters<StorefrontWriteAdmissionPort["markUnknown"]>[0][] = [];
  const admission: StorefrontWriteAdmissionPort = {
    async admit(value) { calls.push("admit"); admissions.push(value);
      return (options.admit ? await options.admit(value) : Object.hasOwn(options, "admitted") ? options.admitted : { kind: "claimed", claim: claim() }) as never; },
    async markUnknown(value) { calls.push("mark"); marks.push(value);
      return (options.mark ? await options.mark(value) : Object.hasOwn(options, "transition") ? options.transition : { kind: "marked_unknown" }) as never; },
  };
  const effect: StorefrontLocalCartEffectPort = { async execute(value) { calls.push("effect"); effects.push(value);
    return (options.effect ? await options.effect(value) : Object.hasOwn(options, "outcome") ? options.outcome : proof()) as never; } };
  return { service: new ExecuteStorefrontLocalCartWrite(admission, effect), calls, admissions, effects, marks, admission, effect };
}
const unknown = { kind: "outcome_unknown", requestId };

test("valid claimed request executes once and returns only a local committed-effect reference", async () => {
  const f = fixture(), original = input();
  assert.deepEqual(await f.service.execute(original), { ...proof(), kind: "local_effect_recorded" });
  assert.deepEqual(f.calls, ["admit", "effect"]);
  assert.deepEqual(f.effects[0], { ...original, claim: claim() });
});
test("existing proof returned by effect is a local effect reference, never lifetime completion", async () => {
  const f = fixture({ outcome: { ...proof(), kind: "receipt_required" } });
  assert.deepEqual(await f.service.execute(input()), { ...proof(), kind: "local_effect_recorded" });
  assert.deepEqual(f.calls, ["admit", "effect"]);
});
for (const admitted of [{ kind: "identity_conflict" }, { kind: "lane_blocked" }, { kind: "revision_conflict" },
  { kind: "scope_unavailable" }, ...["processing", "unknown"].map(state => ({ kind: "receipt_required", requestId, state }))]) {
  test(`admission ${admitted.kind}/${"state" in admitted ? admitted.state : "denial"} never enters business work`, async () => {
    const f = fixture({ admitted }); assert.deepEqual(await f.service.execute(input()), admitted); assert.deepEqual(f.calls, ["admit"]);
  });
}
for (const admitted of [null, {}, { kind: "claimed" }, { kind: "claimed", claim: { ...claim(), claimGeneration: 2 } },
  { kind: "claimed", claim: { ...claim(), claimToken: "bad" } }, { kind: "claimed", claim: claim(), extra: "secret" },
  { kind: "completed" }, { kind: "receipt_required", requestId, state: "completed" }]) {
  test(`malformed admission output is sanitized without invented claim ${String(admitted && "kind" in admitted ? admitted.kind : admitted)}/${Object.keys(admitted ?? {}).join()}`, async () => {
    const f = fixture({ admitted }); assert.deepEqual(await f.service.execute(input()), { kind: "admission_unknown" }); assert.deepEqual(f.calls, ["admit"]);
  });
}
for (const thrown of [new Error(`synthetic-secret-${claimToken}`), undefined, null, false, 0, "", "synthetic-secret"]) {
  test(`admission throw ${typeof thrown}/${String(thrown)} never creates a token or business attempt`, async () => {
    const f = fixture({ admit: async () => { throw thrown; } });
    assert.deepEqual(await f.service.execute(input()), { kind: "admission_unknown" }); assert.deepEqual(f.calls, ["admit"]);
  });
  test(`effect throw ${typeof thrown}/${String(thrown)} attempts unknown once and does not replay`, async () => {
    const f = fixture({ effect: async () => { throw thrown; } });
    assert.deepEqual(await f.service.execute(input()), unknown); assert.deepEqual(f.calls, ["admit", "effect", "mark"]);
    assert.deepEqual(f.marks[0], { scope: input().scope, claim: claim() });
  });
}
for (const outcome of [null, {}, { ...proof(), requestId: effectId }, { ...proof(), revision: 2 }, { ...proof(), revision: 0 },
  { ...proof(), effectId: "bad" }, { ...proof(), claimToken }, { kind: "completed" }, { kind: "receipt_required", requestId, state: "processing" },
  ...["not_current", "identity_conflict", "revision_conflict", "scope_unavailable"].map(kind => ({ kind }))]) {
  test(`execution without matching proof becomes unknown ${String(outcome && "kind" in outcome ? outcome.kind : outcome)}/${Object.keys(outcome ?? {}).join()}`, async () => {
    const f = fixture({ outcome }); assert.deepEqual(await f.service.execute(input()), unknown); assert.deepEqual(f.calls, ["admit", "effect", "mark"]);
  });
}
for (const transition of [{ kind: "not_current" }, null, {}, { kind: "marked_unknown", claimToken }, { kind: "completed" }]) {
  test(`unknown transition result cannot turn execution uncertainty into success ${String(transition && "kind" in transition ? transition.kind : transition)}`, async () => {
    const f = fixture({ outcome: null, transition }); assert.deepEqual(await f.service.execute(input()), unknown);
    assert.deepEqual(f.calls, ["admit", "effect", "mark"]);
  });
}
for (const thrown of [new Error("synthetic-transition-secret"), undefined, null, false, 0, ""]) {
  test(`unknown transition failure ${typeof thrown}/${String(thrown)} stays sanitized and is never retried`, async () => {
    const f = fixture({ outcome: null, mark: async () => { throw thrown; } });
    assert.deepEqual(await f.service.execute(input()), unknown); assert.deepEqual(f.calls, ["admit", "effect", "mark"]);
  });
}
for (const patch of [{ extra: true }, { fingerprint: { version: 1, bytes: new Uint8Array(15) } },
  { scope: { ...input().scope, merchantId: "x\0y" } }, { intent: { ...input().intent, expected_revision: -1 } }]) {
  test(`invalid input throws before all IO ${Object.keys(patch)[0]}`, async () => {
    const f = fixture(); await assert.rejects(f.service.execute({ ...input(), ...patch } as never)); assert.deepEqual(f.calls, []);
  });
}
test("caller changes during admission cannot change the private canonical request or markUnknown scope", async () => {
  const gate = deferred(), original = input(), bytes = Buffer.alloc(48, 17); original.fingerprint.bytes = bytes.subarray(8, 40);
  const f = fixture({ admit: async () => { await gate.promise; return { kind: "claimed", claim: claim() }; }, outcome: null });
  const pending = f.service.execute(original);
  original.scope.cartId = "changed"; original.intent.command.args.variantId = "changed"; original.intent.command.args.quantity = 99; bytes.fill(34);
  gate.resolve(); assert.deepEqual(await pending, unknown);
  assert.equal(f.effects[0].scope.cartId, "cart"); assert.equal(f.effects[0].intent.command.args.variantId, "variant");
  assert.equal(f.effects[0].intent.command.args.quantity, 2); assert.deepEqual([...f.effects[0].fingerprint.bytes], Array(32).fill(17));
  assert.deepEqual(f.marks[0], { scope: input().scope, claim: claim() });
});
test("mutable admission copy cannot corrupt effect identity or private fingerprint", async () => {
  const f = fixture({ admit: async value => {
    value.scope.cartId = "port-mutated"; value.intent.command.args.quantity = 99; value.fingerprint.bytes.fill(34);
    return { kind: "claimed", claim: claim() };
  } });
  assert.equal((await f.service.execute(input())).kind, "local_effect_recorded");
  assert.deepEqual(f.effects[0].scope, input().scope); assert.equal(f.effects[0].intent.command.args.quantity, 2);
  assert.deepEqual([...f.effects[0].fingerprint.bytes], Array(32).fill(17));
});
test("effect copy cannot rewrite scope or token used by failure transition", async () => {
  const f = fixture({ effect: async value => {
    value.scope.principalId = "changed"; value.claim.claimToken = effectId; value.intent.expected_revision = 5; value.fingerprint.bytes.fill(34); throw false;
  } });
  assert.deepEqual(await f.service.execute(input()), unknown); assert.deepEqual(f.marks[0], { scope: input().scope, claim: claim() });
});
test("claim output is detached before execution awaits", async () => {
  const gate = deferred(), offered = claim(), f = fixture({ admitted: { kind: "claimed", claim: offered },
    effect: async () => { await gate.promise; throw new Error("synthetic-effect-error"); } });
  const pending = f.service.execute(input()); await new Promise<void>(resolve => setImmediate(resolve));
  offered.claimToken = effectId; gate.resolve(); assert.deepEqual(await pending, unknown); assert.equal(f.marks[0].claim.claimToken, claimToken);
});
test("port functions are captured before admission awaits and preserve their receiver", async () => {
  const gate = deferred(), f = fixture({ admit: async () => { await gate.promise; return { kind: "claimed", claim: claim() }; }, outcome: null });
  let admissionReceiver: unknown, effectReceiver: unknown, markReceiver: unknown;
  const oldAdmit = f.admission.admit, oldEffect = f.effect.execute, oldMark = f.admission.markUnknown;
  f.admission.admit = function (value) { admissionReceiver = this; return oldAdmit(value); };
  f.effect.execute = function (value) { effectReceiver = this; return oldEffect(value); };
  f.admission.markUnknown = function (value) { markReceiver = this; return oldMark(value); };
  const pending = f.service.execute(input());
  f.effect.execute = async () => { assert.fail("replacement effect must not run"); };
  f.admission.markUnknown = async () => { assert.fail("replacement transition must not run"); };
  gate.resolve(); assert.deepEqual(await pending, unknown);
  assert.equal(admissionReceiver, f.admission); assert.equal(effectReceiver, f.effect); assert.equal(markReceiver, f.admission);
});
test("application reference does not escape while effect promise or unknown transition is pending", async () => {
  const gate = deferred(), f = fixture({ effect: async () => { await gate.promise; return proof(); } }); let settled = false;
  const pending = f.service.execute(input()).then(value => { settled = true; return value; });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false); gate.resolve();
  assert.equal((await pending).kind, "local_effect_recorded");
  const markGate = deferred(), uncertain = fixture({ outcome: null, mark: async () => { await markGate.promise; return { kind: "marked_unknown" }; } }); settled = false;
  const marking = uncertain.service.execute(input()).then(value => { settled = true; return value; });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false); markGate.resolve(); assert.deepEqual(await marking, unknown);
});
test("quantity default is canonical and no implicit second call follows an unknown outcome", async () => {
  const f = fixture({ outcome: null }), original = input(); delete original.intent.command.args.quantity;
  assert.deepEqual(await f.service.execute(original), unknown); assert.equal(f.effects[0].intent.command.args.quantity, 1);
  await new Promise<void>(resolve => setImmediate(resolve)); assert.deepEqual(f.calls, ["admit", "effect", "mark"]);
});

