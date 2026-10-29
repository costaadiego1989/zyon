import { ServiceUnavailableException } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { WebAuthnChallengePersistence } from "../domain/services/webauthn-challenge.service.js";

/** Shared across replicas and deploys; challenge consumption is atomic. */
export class RedisWebAuthnChallengePersistence implements WebAuthnChallengePersistence {
  constructor(private readonly redis: Redis | null) {}
  async put(key: string, expiresAt: number, ttlMs: number): Promise<void> {
    try {
      if (!this.redis) throw new Error("redis_unavailable");
      await this.redis.set("buyer:webauthn:" + key, String(expiresAt), "PX", ttlMs);
    } catch {
      throw new ServiceUnavailableException("webauthn_temporarily_unavailable");
    }
  }
  async take(key: string): Promise<number | null> {
    try {
      if (!this.redis) throw new Error("redis_unavailable");
      const value = await this.redis.eval(
        "local value = redis.call('GET', KEYS[1]); redis.call('DEL', KEYS[1]); return value",
        1, "buyer:webauthn:" + key,
      );
      return value ? Number(value) : null;
    } catch {
      throw new ServiceUnavailableException("webauthn_temporarily_unavailable");
    }
  }
}
