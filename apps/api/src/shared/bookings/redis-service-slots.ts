import { createHash } from "node:crypto";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Redis } from "ioredis";

export interface SlotRequest { resourceId: string; slotId: string; startsAt: string; endsAt: string }
export interface SlotHold { expiresAt: string; slots: SlotRequest[] }
type StoredHold = { owner: string; fingerprint: string; expiresAt: number; slots: SlotRequest[] };
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
local previous = redis.call('GET', KEYS[1])
if previous then
  local held = cjson.decode(previous)
  if held.expiresAt > now then
    if held.fingerprint ~= wanted.fingerprint then return 'changed' end
    for i = 2, #KEYS do
      local lease = redis.call('HGET', KEYS[i], held.owner)
      if not lease or cjson.decode(lease).fingerprint ~= held.fingerprint then return 'unavailable' end
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
          if a.resourceId == b.resourceId and a.startMs < b.endMs and a.endMs > b.startMs then return 'unavailable' end
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
  if not lease or cjson.decode(lease).fingerprint ~= held.fingerprint then return 0 end
end
return 1`;
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
    const wanted = { owner: digest(sessionId), fingerprint: slotFingerprint(slots), slots: slots.map(s => ({ ...s, startMs: Date.parse(s.startsAt), endMs: Date.parse(s.endsAt) })) };
    const result = await this.command(() => this.redis.eval(ACQUIRE, keys.length, ...keys, JSON.stringify(wanted), ttlMs)) as string;
    if (result === "unavailable") throw new ConflictException("service_slot_unavailable");
    if (result === "changed") throw new ConflictException("checkout_service_slot_changed");
    const held = JSON.parse(result) as StoredHold;
    return { expiresAt: new Date(held.expiresAt).toISOString(), slots };
  }
  async assertActive(merchantId: string, sessionId: string, slots: SlotRequest[]): Promise<void> {
    const keys = this.keys(merchantId, sessionId, slots);
    if (await this.command(() => this.redis.eval(ASSERT, keys.length, ...keys, slotFingerprint(slots))) !== 1) throw new ConflictException("checkout_service_hold_expired");
  }
  async active(merchantId: string, resourceId: string): Promise<Array<StoredHold>> {
    const result = await this.command(() => this.redis.eval(READ, 1, this.resourceKey(merchantId, resourceId))) as string[];
    return result.map(raw => JSON.parse(raw) as StoredHold);
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
