import { createHash, randomUUID } from "node:crypto";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Redis } from "ioredis";
import { parseAppointmentLease, type OwnedAppointmentLease } from "./appointment-lease-proof.js";

export interface SlotRequest { resourceId: string; slotId: string; startsAt: string; endsAt: string }
export interface SlotHold { expiresAt: string; slots: SlotRequest[] }
type StoredHold = { owner: string; generation?: string; originFingerprint?: string; fingerprint: string; expiresAt: number; slots: SlotRequest[] };
/** Internal result only. Public acquire/get responses never include this proof. */
export interface ActiveSlotLeaseProof { merchantId: string; ownerHash: string; generation?: string;
  fingerprint: string; selectionFingerprint: string; expiresAt: string; slots: SlotRequest[] }
// The capability survives trusted in-process composition, never JSON/HTTP.
const originalProof = Symbol("original-service-slot-acquisition");
export function withOriginalSlotLeaseProof(hold: SlotHold, proof: ActiveSlotLeaseProof): SlotHold {
  const slots = Object.freeze(proof.slots.map(slot => Object.freeze({ ...slot })));
  const snapshot = Object.freeze({ ...proof, slots }) as unknown as ActiveSlotLeaseProof;
  return Object.defineProperty(hold, originalProof, { value: snapshot, enumerable: false });
}
export function originalSlotLeaseProof(hold: SlotHold | undefined): ActiveSlotLeaseProof | undefined {
  return hold ? (hold as SlotHold & { [originalProof]?: ActiveSlotLeaseProof })[originalProof] : undefined;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
// JSONB may reorder object properties. Compare canonical fields so persisted
// outbox events still identify the lease acquired before that round trip.
export const slotFingerprint = (slots: SlotRequest[]) => digest(JSON.stringify(slots
  .map(({ resourceId, slotId, startsAt, endsAt }) => ({ resourceId, slotId, startsAt, endsAt }))
  .sort((a, b) => a.resourceId.localeCompare(b.resourceId) || a.startsAt.localeCompare(b.startsAt)
    || a.endsAt.localeCompare(b.endsAt) || a.slotId.localeCompare(b.slotId))));

// Redis time is authoritative. Inspect every resource before writing any lease.
const ACQUIRE = `
local nowParts = redis.call('TIME')
local now = tonumber(nowParts[1]) * 1000 + math.floor(tonumber(nowParts[2]) / 1000)
local wanted = cjson.decode(ARGV[1])
local ignored = ARGV[3] and cjson.decode(ARGV[3]) or nil
local previous = redis.call('GET', KEYS[1])
if previous then
  local held = cjson.decode(previous)
  if held.expiresAt > now then
    if held.fingerprint ~= wanted.fingerprint then return 'changed' end
    for i = 2, #KEYS do
      local lease = redis.call('HGET', KEYS[i], held.owner)
      if not lease then return 'unavailable' end
      local indexed = cjson.decode(lease)
      if indexed.fingerprint ~= held.fingerprint or indexed.generation ~= held.generation then return 'unavailable' end
    end
    return previous
  end
end
local expires = now + tonumber(ARGV[2])
for _, slot in ipairs(wanted.slots) do expires = math.min(expires, slot.startMs) end
if expires <= now then return 'unavailable' end
for i = 2, #KEYS do
  local entries = redis.call('HGETALL', KEYS[i])
  for j = 1, #entries, 2 do
    local held = cjson.decode(entries[j + 1])
    if held.expiresAt <= now then redis.call('HDEL', KEYS[i], entries[j])
    elseif held.owner ~= wanted.owner then
      for _, a in ipairs(wanted.slots) do
        for _, b in ipairs(held.slots) do
          local ownSource = ignored and held.owner == ignored.ownerHash and held.generation == ignored.generation
            and (held.originFingerprint or held.fingerprint) == ignored.fingerprint
            and b.resourceId == ignored.target.resourceId and b.slotId == ignored.target.slotId
            and b.startsAt == ignored.target.startsAt and b.endsAt == ignored.target.endsAt
          if not ownSource and a.resourceId == b.resourceId and a.startMs < b.endMs and a.endMs > b.startMs then return 'unavailable' end
        end
      end
    end
  end
end
wanted.expiresAt = expires
local encoded = cjson.encode(wanted)
for i = 2, #KEYS do
  redis.call('HSET', KEYS[i], wanted.owner, encoded)
  redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[2]) + 86400000)
end
redis.call('SET', KEYS[1], encoded, 'PX', tonumber(ARGV[2]) + 86400000)
return encoded`;
const ASSERT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local held = cjson.decode(raw)
if held.expiresAt <= now or held.fingerprint ~= ARGV[1] then return 0 end
for i = 2, #KEYS do
  local lease = redis.call('HGET', KEYS[i], held.owner)
  if not lease then return 0 end
  local indexed = cjson.decode(lease)
  if indexed.fingerprint ~= held.fingerprint or indexed.generation ~= held.generation then return 0 end
end
return raw`;
const ASSERT_CAPTURED = `
local capture = cjson.decode(ARGV[1])
local resources = cjson.decode(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local held = cjson.decode(raw)
if held.owner ~= capture.ownerHash or held.generation ~= capture.generation
  or (held.originFingerprint or held.fingerprint) ~= capture.fingerprint
  or held.expiresAt <= now or held.expiresAt ~= tonumber(ARGV[3]) then return 0 end
local found = false
for _, slot in ipairs(held.slots) do
  if slot.resourceId == capture.target.resourceId and slot.slotId == capture.target.slotId
    and slot.startsAt == capture.target.startsAt and slot.endsAt == capture.target.endsAt then found = true end
end
if not found then return 0 end
for i = 2, #KEYS do
  local needed = false
  for _, slot in ipairs(held.slots) do if slot.resourceId == resources[i - 1] then needed = true end end
  if needed then
    local indexedRaw = redis.call('HGET', KEYS[i], capture.ownerHash)
    if not indexedRaw then return 0 end
    local indexed = cjson.decode(indexedRaw)
    if indexed.owner ~= held.owner or indexed.generation ~= held.generation or indexed.fingerprint ~= held.fingerprint
      or indexed.expiresAt ~= held.expiresAt then return 0 end
  end
end
return raw`;
const READ = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local result = {}
local entries = redis.call('HGETALL', KEYS[1])
for i = 1, #entries, 2 do
  local held = cjson.decode(entries[i + 1])
  if held.expiresAt <= now then redis.call('HDEL', KEYS[1], entries[i])
  else table.insert(result, entries[i + 1]) end
end
return result`;
const RELEASE = `
local raw = redis.call('GET', KEYS[1])
if not raw or cjson.decode(raw).fingerprint ~= ARGV[1] then return 0 end
for i = 2, #KEYS do redis.call('HDEL', KEYS[i], ARGV[2]) end
redis.call('DEL', KEYS[1])
return 1`;

// Private cleanup: no current-cart guess and no whole-owner release. The parent
// and every original resource may already belong to a newer generation.
const RELEASE_CAPTURED = `
local wanted = cjson.decode(ARGV[1])
local resources = cjson.decode(ARGV[2])
local remaining = cjson.decode(ARGV[3])
local expected = ARGV[4]
local encoded = ARGV[5]
local parent = redis.call('GET', KEYS[1])
local function own(raw)
  if not raw then return false end
  local held = cjson.decode(raw)
  return held.owner == wanted.ownerHash and held.generation == wanted.generation
    and (held.originFingerprint or held.fingerprint) == wanted.fingerprint
end
local function consistent(raw)
  if not own(raw) then return true end
  return cjson.decode(raw).fingerprint == expected
end
if not consistent(parent) then return 'changed' end
for i = 2, #KEYS do
  if not consistent(redis.call('HGET', KEYS[i], wanted.ownerHash)) then return 'changed' end
end
if own(parent) then
  if #remaining == 0 then redis.call('DEL', KEYS[1])
  else redis.call('SET', KEYS[1], encoded, 'KEEPTTL') end
end
for i = 2, #KEYS do
  local raw = redis.call('HGET', KEYS[i], wanted.ownerHash)
  if own(raw) then
    local keep = false
    for _, slot in ipairs(remaining) do if slot.resourceId == resources[i - 1] then keep = true end end
    if keep then redis.call('HSET', KEYS[i], wanted.ownerHash, encoded)
    else redis.call('HDEL', KEYS[i], wanted.ownerHash) end
  end
end
return 'released'`;

export class RedisServiceSlots {
  constructor(readonly redis: Redis) {}
  private prefix(merchantId: string) { return `service-slots:{${digest(merchantId)}}`; }
  resourceKey(merchantId: string, resourceId: string) { return `${this.prefix(merchantId)}:resource:${digest(resourceId)}:holds`; }
  checkoutKey(merchantId: string, sessionId: string) { return `${this.prefix(merchantId)}:checkout:${digest(sessionId)}`; }
  private keys(merchantId: string, sessionId: string, slots: SlotRequest[]) {
    return [this.checkoutKey(merchantId, sessionId), ...[...new Set(slots.map(s => s.resourceId))].sort().map(id => this.resourceKey(merchantId, id))];
  }
  private async command<T>(run: () => Promise<T>): Promise<T> {
    try {
      if (this.redis.status === "wait") await this.redis.connect();
      if (this.redis.status !== "ready") await new Promise<void>((resolve, reject) => {
        const ready = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("redis_unavailable")); };
        const cleanup = () => { clearTimeout(timer); this.redis.off("ready", ready); this.redis.off("error", failed); };
        const timer = setTimeout(failed, 3000);
        this.redis.once("ready", ready); this.redis.once("error", failed);
      });
      return await run();
    }
    catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException("service_schedule_temporarily_unavailable");
    }
  }
  async acquire(merchantId: string, sessionId: string, slots: SlotRequest[], ttlMs = 10 * 60_000): Promise<SlotHold> {
    const keys = this.keys(merchantId, sessionId, slots);
    const wanted = { owner: digest(sessionId), generation: randomUUID(), originFingerprint: slotFingerprint(slots), fingerprint: slotFingerprint(slots), slots: slots.map(s => ({ ...s, startMs: Date.parse(s.startsAt), endMs: Date.parse(s.endsAt) })) };
    const result = await this.command(() => this.redis.eval(ACQUIRE, keys.length, ...keys, JSON.stringify(wanted), ttlMs)) as string;
    if (result === "unavailable") throw new ConflictException("service_slot_unavailable");
    if (result === "changed") throw new ConflictException("checkout_service_slot_changed");
    const held = JSON.parse(result) as StoredHold;
    return withOriginalSlotLeaseProof({ expiresAt: new Date(held.expiresAt).toISOString(), slots }, {
      merchantId, ownerHash: held.owner, generation: held.generation, fingerprint: held.originFingerprint ?? held.fingerprint,
      selectionFingerprint: held.fingerprint, expiresAt: new Date(held.expiresAt).toISOString(),
      slots: held.slots.map(({ resourceId, slotId, startsAt, endsAt }) => ({ resourceId, slotId, startsAt, endsAt })),
    });
  }
  async assertActive(merchantId: string, sessionId: string, slots: SlotRequest[]): Promise<ActiveSlotLeaseProof> {
    const keys = this.keys(merchantId, sessionId, slots);
    const raw = await this.command(() => this.redis.eval(ASSERT, keys.length, ...keys, slotFingerprint(slots)));
    if (typeof raw !== "string") throw new ConflictException("checkout_service_hold_expired");
    const held = JSON.parse(raw) as StoredHold;
    return { merchantId, ownerHash: held.owner, generation: held.generation,
      fingerprint: held.originFingerprint ?? held.fingerprint, selectionFingerprint: held.fingerprint,
      expiresAt: new Date(held.expiresAt).toISOString(), slots: held.slots.map(({ resourceId, slotId, startsAt, endsAt }) => ({ resourceId, slotId, startsAt, endsAt })) };
  }
  /** Original immutable SQL binding authorizes only this target's overlap. */
  async acquireForAppointmentReschedule(merchantId: string, sessionId: string, slots: SlotRequest[], ttlMs: number,
    source: OwnedAppointmentLease): Promise<SlotHold> {
    const capture = parseAppointmentLease(source);
    if (!capture || capture.kind !== "owned" || capture.merchantId !== merchantId || capture.ownerHash === digest(sessionId))
      throw new ConflictException("service_hold_cleanup_foreign_proof");
    const keys = this.keys(merchantId, sessionId, slots), fingerprint = slotFingerprint(slots);
    const wanted = { owner: digest(sessionId), generation: randomUUID(), originFingerprint: fingerprint, fingerprint,
      slots: slots.map(s => ({ ...s, startMs: Date.parse(s.startsAt), endMs: Date.parse(s.endsAt) })) };
    const result = await this.command(() => this.redis.eval(ACQUIRE, keys.length, ...keys, JSON.stringify(wanted), ttlMs, JSON.stringify(capture))) as string;
    if (result === "unavailable") throw new ConflictException("service_slot_unavailable");
    if (result === "changed") throw new ConflictException("checkout_service_slot_changed");
    const held = JSON.parse(result) as StoredHold;
    return withOriginalSlotLeaseProof({ expiresAt: new Date(held.expiresAt).toISOString(), slots }, {
      merchantId, ownerHash: held.owner, generation: held.generation, fingerprint: held.originFingerprint ?? held.fingerprint,
      selectionFingerprint: held.fingerprint, expiresAt: new Date(held.expiresAt).toISOString(),
      slots: held.slots.map(({ resourceId, slotId, startsAt, endsAt }) => ({ resourceId, slotId, startsAt, endsAt })),
    });
  }
  async active(merchantId: string, resourceId: string): Promise<Array<StoredHold>> {
    const result = await this.command(() => this.redis.eval(READ, 1, this.resourceKey(merchantId, resourceId))) as string[];
    return result.map(raw => JSON.parse(raw) as StoredHold);
  }
  /** Original private SQL receipt, never a reconstructed buyer/session owner. */
  async assertCapturedActive(merchantId: string, source: OwnedAppointmentLease): Promise<ActiveSlotLeaseProof> {
    const capture = parseAppointmentLease(source);
    if (!capture || capture.kind !== "owned" || capture.merchantId !== merchantId) throw new ConflictException("service_manual_original_hold_required");
    const resources = [...capture.resources].sort(), keys = [this.prefix(merchantId) + ":checkout:" + capture.ownerHash,
      ...resources.map(resource => this.resourceKey(merchantId, resource))];
    const raw = await this.command(() => this.redis.eval(ASSERT_CAPTURED, keys.length, ...keys, JSON.stringify(capture), JSON.stringify(resources), Date.parse(capture.expiresAt)));
    if (typeof raw !== "string") throw new ConflictException("service_manual_original_hold_required");
    const held = JSON.parse(raw) as StoredHold;
    return { merchantId, ownerHash: held.owner, generation: held.generation, fingerprint: held.originFingerprint ?? held.fingerprint,
      selectionFingerprint: held.fingerprint, expiresAt: new Date(held.expiresAt).toISOString(),
      slots: held.slots.map(({ resourceId, slotId, startsAt, endsAt }) => ({ resourceId, slotId, startsAt, endsAt })) };
  }
  async assertNoForeignHold(merchantId: string, resourceId: string, sessionId: string, startsAt: Date, endsAt: Date): Promise<void> {
    const holds = await this.active(merchantId, resourceId);
    if (holds.some(h => h.owner !== digest(sessionId) && h.slots.some(s => s.resourceId === resourceId && Date.parse(s.startsAt) < endsAt.getTime() && Date.parse(s.endsAt) > startsAt.getTime()))) throw new ConflictException("service_capacity_unavailable");
  }
  async get(merchantId: string, sessionId: string): Promise<SlotHold | undefined> {
    const raw = await this.command(() => this.redis.get(this.checkoutKey(merchantId, sessionId)));
    if (!raw) return undefined;
    const held = JSON.parse(raw) as StoredHold;
    const slots = held.slots.map(({ resourceId, slotId, startsAt, endsAt }) => ({ resourceId, slotId, startsAt, endsAt }));
    try { await this.assertActive(merchantId, sessionId, slots); }
    catch (error) { if (error instanceof ConflictException) return undefined; throw error; }
    return { expiresAt: new Date(held.expiresAt).toISOString(), slots };
  }
  async release(merchantId: string, sessionId: string, fingerprint?: string): Promise<void> {
    const raw = await this.command(() => this.redis.get(this.checkoutKey(merchantId, sessionId)));
    if (!raw) return;
    const held = JSON.parse(raw) as StoredHold;
    if (fingerprint && fingerprint !== held.fingerprint) return;
    const keys = this.keys(merchantId, sessionId, held.slots);
    await this.command(() => this.redis.eval(RELEASE, keys.length, ...keys, held.fingerprint, digest(sessionId)));
  }
  /** Safe after SQL commit and safe to replay after a lost Redis response. */
  async releaseCaptured(merchantId: string, capture: OwnedAppointmentLease): Promise<{ released: boolean }> {
    if (capture.merchantId !== merchantId || !/^[a-f0-9]{64}$/.test(capture.ownerHash)
      || !Array.isArray(capture.resources) || !capture.resources.includes(capture.target.resourceId))
      throw new ConflictException("service_hold_cleanup_foreign_proof");
    const resources = [...new Set(capture.resources)].sort();
    const keys = [this.prefix(merchantId) + ":checkout:" + capture.ownerHash, ...resources.map(id => this.resourceKey(merchantId, id))];
    const raws = await this.command(async () => [await this.redis.get(keys[0]), ...await Promise.all(keys.slice(1).map(key => this.redis.hget(key, capture.ownerHash)))]);
    const held = raws.filter((v): v is string => typeof v === "string").map(raw => JSON.parse(raw) as StoredHold)
      .find(value => value.owner === capture.ownerHash && value.generation === capture.generation
        && (value.originFingerprint ?? value.fingerprint) === capture.fingerprint
        && value.slots.some(slot => slot.resourceId === capture.target.resourceId && slot.slotId === capture.target.slotId
          && slot.startsAt === capture.target.startsAt && slot.endsAt === capture.target.endsAt));
    if (!held) return { released: false };
    const remaining = held.slots.filter(slot => !(slot.resourceId === capture.target.resourceId && slot.slotId === capture.target.slotId
      && slot.startsAt === capture.target.startsAt && slot.endsAt === capture.target.endsAt));
    const updated = { ...held, fingerprint: slotFingerprint(remaining), slots: remaining };
    const result = await this.command(() => this.redis.eval(RELEASE_CAPTURED, keys.length, ...keys,
      JSON.stringify(capture), JSON.stringify(resources), JSON.stringify(remaining), held.fingerprint, JSON.stringify(updated)));
    if (result === "changed") throw new ConflictException("service_hold_cleanup_changed");
    return { released: result === "released" };
  }
  async cacheSchedule(merchantId: string, resourceId: string, schedule: unknown): Promise<void> {
    await this.command(() => this.redis.set(`${this.prefix(merchantId)}:resource:${digest(resourceId)}:schedule`, JSON.stringify(schedule), "EX", 86400));
  }
}

export function closeServiceSlotStore() { configured?.redis.disconnect(); configured = undefined; }

let configured: RedisServiceSlots | undefined;
export function serviceSlotStore(): RedisServiceSlots {
  if (configured) return configured;
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new ServiceUnavailableException("service_schedule_temporarily_unavailable");
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
  redis.on("error", () => {});
  configured = new RedisServiceSlots(redis);
  return configured;
}
