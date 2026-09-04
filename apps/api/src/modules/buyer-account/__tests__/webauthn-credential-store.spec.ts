import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryWebAuthnCredentialStore } from "../infrastructure/in-memory-webauthn-credential-store.js";
import { WebAuthnCredential } from "../domain/entities/webauthn-credential.entity.js";

const baseProps = () => ({
  id: "cred_1",
  credentialId: "Y3JlZGVudGlhbF9pZA",
  globalUserId: "guser_1",
  publicKey: new Uint8Array([4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64]),
  counter: 0,
  transports: ["internal" as const],
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  lastUsedAt: null,
  aaguid: "00000000-0000-0000-0000-000000000000",
});

test("InMemoryWebAuthnCredentialStore.save persists and findByCredentialId returns the row", async () => {
  const store = new InMemoryWebAuthnCredentialStore();
  const cred = new WebAuthnCredential({ ...baseProps(), globalUserId: "guser_1", origin: "https://shop.example.com" });
  await store.save(cred);

  const fetched = await store.findByCredentialId("Y3JlZGVudGlhbF9pZA");
  assert.ok(fetched);
  assert.equal(fetched!.globalUserId, "guser_1");
  assert.equal(fetched!.origin, "https://shop.example.com");
});

test("InMemoryWebAuthnCredentialStore.findByCredentialId returns null when missing", async () => {
  const store = new InMemoryWebAuthnCredentialStore();
  assert.equal(await store.findByCredentialId("missing"), null);
});

test("InMemoryWebAuthnCredentialStore.listByGlobalUserId returns only the user's credentials", async () => {
  const store = new InMemoryWebAuthnCredentialStore();
  await store.save(new WebAuthnCredential({ ...baseProps(), globalUserId: "guser_1", credentialId: "c1", origin: "https://shop.example.com" }));
  await store.save(new WebAuthnCredential({ ...baseProps(), id: "cred_2", globalUserId: "guser_1", credentialId: "c2", origin: "https://shop.example.com" }));
  await store.save(new WebAuthnCredential({ ...baseProps(), id: "cred_3", globalUserId: "guser_2", credentialId: "c3", origin: "https://shop.example.com" }));

  const mine = await store.listByGlobalUserId("guser_1");
  assert.equal(mine.length, 2);
  assert.ok(mine.every((c) => c.globalUserId === "guser_1"));
});

test("InMemoryWebAuthnCredentialStore.deleteById removes only the targeted row", async () => {
  const store = new InMemoryWebAuthnCredentialStore();
  await store.save(new WebAuthnCredential({ ...baseProps(), globalUserId: "guser_1", credentialId: "c1", origin: "https://shop.example.com" }));
  await store.save(new WebAuthnCredential({ ...baseProps(), id: "cred_2", globalUserId: "guser_1", credentialId: "c2", origin: "https://shop.example.com" }));

  await store.deleteById("cred_1");
  assert.equal(await store.findByCredentialId("c1"), null);
  assert.ok(await store.findByCredentialId("c2"));
});

test("InMemoryWebAuthnCredentialStore.updateCounter persists the new counter (replay protection)", async () => {
  const store = new InMemoryWebAuthnCredentialStore();
  await store.save(new WebAuthnCredential({ ...baseProps(), credentialId: "c1", origin: "https://shop.example.com" }));
  const fetched = await store.findByCredentialId("c1");
  assert.ok(fetched);
  await store.updateCounter(fetched!.id, 42);
  const after = await store.findByCredentialId("c1");
  assert.equal(after!.counter, 42);
});

test("InMemoryWebAuthnCredentialStore enforces max-credentials-per-user cap (10)", async () => {
  const store = new InMemoryWebAuthnCredentialStore();
  for (let i = 0; i < 10; i += 1) {
    await store.save(
      new WebAuthnCredential({ ...baseProps(), id: `cred_${i}`, credentialId: `c${i}`, origin: "https://shop.example.com" })
    );
  }
  await assert.rejects(
    () =>
      store.save(
        new WebAuthnCredential({ ...baseProps(), id: "cred_11", credentialId: "c11", origin: "https://shop.example.com" })
      ),
    /webauthn_max_credentials_per_user/
  );
});
