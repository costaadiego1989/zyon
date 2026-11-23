import { RedisServiceSlots, slotFingerprint, type SlotRequest } from "../src/shared/bookings/redis-service-slots.js";

/** Bounded component protocol double, not native Lua/Redis evidence. The
 * actual RedisServiceSlots creates UUIDs/private receipts. No fake success or
 * supplied authority object is returned by this fixture. */
export function initialLeaseMemory() {
  const state = { held: undefined as any, acquireCalls: 0, releaseCalls: 0, loseAck: false,
    pause: undefined as Promise<void> | undefined, onRelease: undefined as (() => void) | undefined, beforeReturn: undefined as (() => void) | undefined };
  const redis: any = { status: "ready", get: async () => state.held ? JSON.stringify(state.held) : null,
    hget: async () => state.held ? JSON.stringify(state.held) : null,
    eval: async (script: string, keyCount: number, ...args: any[]) => {
      if (script.includes("local nowParts = redis.call('TIME')")) {
        state.acquireCalls++; const wanted = JSON.parse(args[keyCount]), ttl = Number(args[keyCount + 1]);
        if (!state.held) state.held = { ...wanted, expiresAt: Date.now() + ttl };
        if (state.beforeReturn) state.beforeReturn(); if (state.pause) await state.pause;
        if (state.loseAck) throw Error("synthetic_acquire_ack_lost"); return JSON.stringify(state.held);
      }
      state.releaseCalls++; state.onRelease?.(); state.held = undefined; return "released";
    },
  };
  const store = new RedisServiceSlots(redis);
  const replace = (generation = "22222222-2222-4222-8222-222222222222") => { if (state.held) state.held = { ...state.held, generation }; };
  const seed = (slots: SlotRequest[], owner: string, generation = "11111111-1111-4111-8111-111111111111") => {
    state.held = { owner, generation, originFingerprint: slotFingerprint(slots), fingerprint: slotFingerprint(slots), slots,
      expiresAt: Date.now() + 240000 };
  };
  return { state, store, replace, seed };
}
