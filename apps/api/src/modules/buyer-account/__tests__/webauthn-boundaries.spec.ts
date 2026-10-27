import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ValidationPipe } from "@nestjs/common";
import type { Redis } from "ioredis";
import { RedisWebAuthnChallengePersistence } from "../infrastructure/redis-webauthn-challenge.persistence.js";
import { WebAuthnChallengeService } from "../domain/services/webauthn-challenge.service.js";
import { WebAuthnLoginDto, WebAuthnRegistrationDto } from "../presentation/http/buyer-webauthn.dto.js";
import { PrismaWebAuthnCredentialRepository } from "../infrastructure/prisma-webauthn-credential.repository.js";
import type { PrismaClient } from "@prisma/client";

test("Shared persistence supports a new API instance and atomically consumes a challenge once", async () => {
  const records = new Map<string, string>();
  const redis = {
    set: async (key: string, value: string, mode: string, ttl: number) => {
      assert.equal(mode, "PX"); assert.equal(ttl, 300000); records.set(key, value); return "OK";
    },
    eval: async (_script: string, _count: number, key: string) => {
      const value = records.get(key); records.delete(key); return value ?? null;
    },
  } as unknown as Redis;
  const beforeDeploy = new WebAuthnChallengeService(new RedisWebAuthnChallengePersistence(redis));
  const afterDeploy = new WebAuthnChallengeService(new RedisWebAuthnChallengePersistence(redis));
  const issued = await beforeDeploy.issue("login");
  const results = await Promise.all([afterDeploy.consume(issued.challenge, "login"), beforeDeploy.consume(issued.challenge, "login")]);
  assert.equal(results.filter(Boolean).length, 1);
});
test("Missing Redis fails safely instead of starting a non-durable login ceremony", async () => {
  const service = new WebAuthnChallengeService(new RedisWebAuthnChallengePersistence(null));
  await assert.rejects(() => service.issue("login"), /temporarily_unavailable/);
});
test("HTTP validation rejects malformed and missing nested credential data", async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const metatype of [WebAuthnLoginDto, WebAuthnRegistrationDto]) {
    for (const value of [{}, { challenge: "x".repeat(43), credential: {} }, { challenge: "x".repeat(43), credential: null }]) {
      await assert.rejects(() => pipe.transform(value, { type: "body", metatype }));
    }
  }
});
test("Runtime repository updates counters conditionally and rejects a concurrent stale assertion", async () => {
  let current = 1;
  const prisma = { webAuthnCredential: { updateMany: async ({ where, data }: any) => {
    assert.equal(where.id, "cred");
    const allowed = typeof where.counter === "number" ? current === where.counter : current < where.counter.lt;
    if (allowed) current = data.counter;
    return { count: allowed ? 1 : 0 };
  } } } as unknown as PrismaClient;
  const store = new PrismaWebAuthnCredentialRepository(prisma);
  await store.updateCounter("cred", 3);
  await assert.rejects(() => store.updateCounter("cred", 2), /counter_replayed/);
  assert.equal(current, 3);
});
