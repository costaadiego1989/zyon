import assert from 'node:assert/strict';
import test from 'node:test';
import { ScopedConversationSession } from './scoped-conversation.js';
import { prepareConversationTurn } from './prepare-conversation-turn.js';

class Expired extends Error {}
function fixture() {
  let current = true, protectedCart: string | null = null, recovery = false;
  let creates = 0;
  const calls: string[] = [];
  const owner = new ScopedConversationSession('store', {
    create: async () => { creates++; return { conversation_id: 'fresh', merchant_id: 'store', experiment: { variant_id: 'fresh-variant' } }; },
    isCurrent: () => current, hasAccess: () => true, protectedCart: () => protectedCart,
    isReadOnly: () => recovery, save: id => calls.push('save:' + id), clear: id => calls.push('clear:' + id), isRetired: () => false,
  }, 'old');
  const options = { owner, hint: 'old', hasBuyerHistory: false, hasVoiceProof: false,
    isCurrent: () => current, isExpired: (error: unknown) => error instanceof Expired,
    ensureAccess: async (id: string) => { calls.push('access:' + id); if (id === 'old') throw new Expired(); },
  };
  return { options, owner, calls, creates: () => creates,
    protect: () => { protectedCart = 'old'; }, recover: () => { recovery = true; }, invalidate: () => { current = false; } };
}
test('empty expired conversation is replaced before dispatch and retains new experiment metadata', async () => {
  const f = fixture();
  const result = await prepareConversationTurn(f.options);
  assert.equal(result?.conversation_id, 'fresh');
  assert.equal(result?.experiment.variant_id, 'fresh-variant');
  assert.equal(f.creates(), 1);
  assert.deepEqual(f.calls, ['access:old', 'clear:old', 'save:fresh', 'access:fresh']);
});
test('healthy capability keeps the original identity without replacement', async () => {
  const f = fixture();
  const result = await prepareConversationTurn({ ...f.options, ensureAccess: async () => {} });
  assert.equal(result?.conversation_id, 'old'); assert.equal(f.creates(), 0);
});
test('buyer history or a voice proof cannot move to a different identity', async () => {
  for (const extra of [{ hasBuyerHistory: true }, { hasVoiceProof: true }]) {
    const f = fixture();
    await assert.rejects(prepareConversationTurn({ ...f.options, ...extra }), Expired);
    assert.equal(f.creates(), 0); assert.equal(f.owner.id, 'old');
  }
});
test('persisted cart and pending recovery are protected by the actual owner', async () => {
  for (const protection of ['cart', 'recovery']) {
    const f = fixture(); if (protection === 'cart') f.protect(); else f.recover();
    await assert.rejects(prepareConversationTurn(f.options), /conversation_recovery_required/);
    assert.equal(f.creates(), 0); assert.equal(f.owner.id, 'old');
  }
});
test('a transient access failure never triggers replacement', async () => {
  const f = fixture();
  await assert.rejects(prepareConversationTurn({ ...f.options, ensureAccess: async () => { throw Error('temporary'); } }), /temporary/);
  assert.equal(f.creates(), 0); assert.equal(f.owner.id, 'old');
});
test('merchant invalidation while awaiting preflight never replaces or accepts identity', async () => {
  const f = fixture(); let release!: () => void;
  const pending = prepareConversationTurn({ ...f.options, ensureAccess: () => new Promise(resolve => { release = resolve; }) });
  await new Promise(resolve => setImmediate(resolve)); f.invalidate(); release();
  assert.equal(await pending, null); assert.equal(f.creates(), 0);
});
