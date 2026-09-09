import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { ConfigureWhatsAppUseCase } from "./configure-whatsapp.use-case.js";
import { TwilioOnboardingError, type ChannelPatch, type OnboardingLease, type WhatsAppOnboardingStore } from "../../domain/ports/whatsapp-onboarding.port.js";
import type { WhatsAppChannelConfigEntity } from "../../domain/ports/whatsapp-config-repository.port.js";
import { WhatsAppConfigController, WhatsAppSignupDto, WhatsAppToggleDto } from "../../presentation/http/whatsapp-config.controller.js";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

const input = { merchantId: "merchant-a", code: "oauth-test", wabaId: "123456789", phoneNumberId: "987654321" };
const assets = { accessToken: "merchant-meta-token", wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, whatsappNumber: "+5511999999999" };

function setup() {
  let config: WhatsAppChannelConfigEntity = {
    id: "cfg-a", merchantId: input.merchantId, provider: "META_CLOUD", credentials: {}, status: "DISCONNECTED", enabled: false,
    createdAt: new Date(), updatedAt: new Date(),
  };
  let locked = false;
  const writes: ChannelPatch[] = [];
  const calls = { authorize: 0, subscribe: 0, subscribed: 0, templates: 0 };
  const store: WhatsAppOnboardingStore = {
    claim: async () => { if (locked) return null; locked = true; return { token: "lease", config: structuredClone(config) }; },
    save: async (lease: OnboardingLease, patch) => {
      writes.push(structuredClone(patch));
      config = { ...config, ...structuredClone(patch) };
      lease.config = structuredClone(config);
      return lease.config;
    },
    release: async () => { locked = false; },
  };
  const authorization = {
    authorize: async (received: typeof input) => { calls.authorize++; assert.deepEqual(received, input); return structuredClone(assets); },
    subscribe: async () => { calls.subscribe++; },
    isSubscribed: async () => { calls.subscribed++; return true; },
  };
  const repo = { findByMerchantId: async () => structuredClone(config) } as any;
  const useCase = new ConfigureWhatsAppUseCase(repo, store, authorization, { execute: async () => { calls.templates++; } } as any);
  return {
    useCase, authorization, calls, writes,
    config: () => config,
    setConfig: (value: Partial<WhatsAppChannelConfigEntity>) => { config = { ...config, ...value }; },
  };
}

test("authorizes Meta assets server-side, subscribes the WABA, and activates only after subscription", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { META_EMBEDDED_SIGNUP_APP_ID: "123456", META_EMBEDDED_SIGNUP_CONFIGURATION_ID: "234567", META_APP_SECRET: "secret", META_WEBHOOK_VERIFY_TOKEN: "verify-token" });
  try {
    const s = setup();
    assert.equal((await s.useCase.connectViaEmbeddedSignup(input)).status, "active");
    assert.equal(s.calls.authorize, 1);
    assert.equal(s.calls.subscribe, 1);
    assert.equal(s.calls.templates, 1);
    assert.equal(s.config().provider, "META_CLOUD");
    assert.equal(s.config().status, "ACTIVE");
    assert.equal(s.config().enabled, true);
    assert.deepEqual(s.config().credentials.accessToken, assets.accessToken);
    const publicData = JSON.stringify(await s.useCase.connection(input.merchantId));
    assert.ok(!publicData.includes(assets.accessToken));
  } finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
});

test("unknown subscription preserves the authorized connection for reconciliation without enabling it", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { META_EMBEDDED_SIGNUP_APP_ID: "123456", META_EMBEDDED_SIGNUP_CONFIGURATION_ID: "234567", META_APP_SECRET: "secret", META_WEBHOOK_VERIFY_TOKEN: "verify-token" });
  try {
    const s = setup();
    s.authorization.subscribe = async () => { throw new TwilioOnboardingError("META_SUBSCRIPTION_UNKNOWN", true); };
    const result: any = await s.useCase.connectViaEmbeddedSignup(input);
    assert.equal(result.status, "provisioning");
    assert.equal(result.error, "META_SUBSCRIPTION_UNKNOWN");
    assert.equal(s.config().enabled, false);
    assert.equal(s.config().credentials.accessToken, assets.accessToken);
  } finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
});

test("refresh only reads subscription state and never issues a second subscription POST", async () => {
  const s = setup();
  s.setConfig({ status: "PROVISIONING", enabled: false, whatsappNumber: "5511999999999", credentials: {
    onboardingVersion: 3, accessToken: assets.accessToken, wabaId: assets.wabaId, phoneNumberId: assets.phoneNumberId, desiredEnabled: true,
  } });
  assert.equal((await s.useCase.refresh(input.merchantId)).status, "active");
  assert.equal(s.calls.subscribed, 1);
  assert.equal(s.calls.subscribe, 0);
  assert.equal(s.calls.templates, 1);
});

test("connection identity cannot silently switch to a different WABA", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { META_EMBEDDED_SIGNUP_APP_ID: "123456", META_EMBEDDED_SIGNUP_CONFIGURATION_ID: "234567", META_APP_SECRET: "secret", META_WEBHOOK_VERIFY_TOKEN: "verify-token" });
  try {
    const s = setup();
    s.setConfig({ credentials: { wabaId: "other-waba" } });
    await assert.rejects(s.useCase.connectViaEmbeddedSignup(input), ConflictException);
  } finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
});

test("disconnect removes the merchant token and an inactive channel cannot be enabled", async () => {
  const s = setup();
  s.setConfig({ status: "ACTIVE", enabled: true, credentials: { onboardingVersion: 3, ...assets }, whatsappNumber: "5511999999999" });
  assert.equal((await s.useCase.disconnect(input.merchantId)).status, "disconnected");
  assert.equal(s.config().enabled, false);
  assert.equal(s.config().credentials.accessToken, undefined);
  await assert.rejects(s.useCase.setEnabled(input.merchantId, true), ConflictException);
});

test("does not present Meta onboarding as ready without the webhook verification token", () => {
  const previous = { ...process.env };
  Object.assign(process.env, { META_EMBEDDED_SIGNUP_APP_ID: "123456", META_EMBEDDED_SIGNUP_CONFIGURATION_ID: "234567", META_APP_SECRET: "secret" });
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
  try { assert.equal(setup().useCase.settings().configured, false); }
  finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
});

test("controller scopes every Meta connection endpoint to the authenticated merchant", () => {
  const controller = new WhatsAppConfigController({} as any);
  const request = { user: { merchantId: "different" } } as any;
  const operations = [
    () => controller.settings(request, input.merchantId),
    () => controller.getConnection(request, input.merchantId),
    () => controller.connectViaEmbeddedSignup(request, input.merchantId, input),
    () => controller.refresh(request, input.merchantId),
    () => controller.disconnect(request, input.merchantId),
    () => controller.toggle(request, input.merchantId, { enabled: true }),
  ];
  for (const operation of operations) assert.throws(operation, ForbiddenException);
});

test("signup and toggle DTOs reject malformed data", async () => {
  assert.ok((await validate(plainToInstance(WhatsAppSignupDto, { ...input, code: "" }))).length);
  assert.ok((await validate(plainToInstance(WhatsAppSignupDto, { ...input, wabaId: "../attack" }))).length);
  assert.ok((await validate(plainToInstance(WhatsAppToggleDto, { enabled: "false" }))).length);
  assert.equal((await validate(plainToInstance(WhatsAppSignupDto, input))).length, 0);
});
