import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { SendBuyerPhoneCodeUseCase } from "./send-buyer-phone-code.use-case.js";
import { SendBuyerEmailCodeUseCase } from "./send-buyer-email-code.use-case.js";
import { VerifyBuyerPhoneCodeUseCase } from "./verify-buyer-phone-code.use-case.js";
import { VerifyBuyerEmailCodeUseCase } from "./verify-buyer-email-code.use-case.js";
import { BubbleWhatsSmsSender } from "../../infrastructure/bubblewhats-sms-sender.js";
import { ResendEmailOtpSender } from "../../infrastructure/resend-email-otp-sender.js";
import { InMemoryOtpStore } from "../../infrastructure/in-memory-otp-store.js";
import { InMemoryBuyerAccountRepository } from "../../infrastructure/in-memory-buyer-account.repository.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { PrismaOtpStore } from "../../infrastructure/prisma-otp-store.js";
import { RedisOtpStore } from "../../infrastructure/redis-otp-store.js";

const phone = "5511999991234";
const email = "buyer-private@example.com";
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
const unavailable = (error: unknown) => error instanceof ServiceUnavailableException && error.getStatus() === 503;

function sender(channel: "sms" | "email", fetcher: typeof fetch, timeoutMs = 10000) {
  return channel === "sms"
    ? new BubbleWhatsSmsSender({ baseUrl: "https://sms.example", token: "secret-token" }, { fetch: fetcher, timeoutMs })
    : new ResendEmailOtpSender({ apiKey: "secret-token", fromEmail: "noreply@example.com" }, { fetch: fetcher, timeoutMs });
}

test("missing channels never activate a challenge or report a simulated send", async () => {
  const store = new InMemoryOtpStore();
  for (const useCase of [new SendBuyerPhoneCodeUseCase(store), new SendBuyerPhoneCodeUseCase(store, new BubbleWhatsSmsSender({}))]) {
    await assert.rejects(useCase.execute({ phone }), /otp_sms_unavailable/);
  }
  for (const useCase of [new SendBuyerEmailCodeUseCase(store), new SendBuyerEmailCodeUseCase(store, new ResendEmailOtpSender({}))]) {
    await assert.rejects(useCase.execute({ email }), /otp_email_unavailable/);
  }
  assert.equal(await store.findActive(`BR:${phone}`), null);
  assert.equal(await store.findActive(`email:${email}`), null);
});

test("provider 4xx/5xx and network failures reject both channels without saving new challenges", async () => {
  for (const channel of ["sms", "email"] as const) {
    for (const status of [400, 401, 429, 500, 503, 0]) {
      const store = new InMemoryOtpStore();
      let calls = 0;
      const fetcher: typeof fetch = async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, "error");
        assert.ok(init?.signal);
        if (!status) throw new Error(`provider echoed ${phone} ${email} 123456`);
        return new Response(`provider echoed ${phone} ${email} 123456`, { status });
      };
      if (channel === "sms") {
        await assert.rejects(new SendBuyerPhoneCodeUseCase(store, sender(channel, fetcher)).execute({ phone }), unavailable);
      } else {
        await assert.rejects(new SendBuyerEmailCodeUseCase(store, sender(channel, fetcher)).execute({ email }), unavailable);
      }
      assert.equal(calls, 1, "delivery does not retry OTP messages automatically");
      assert.equal(await store.findActive(channel === "sms" ? `BR:${phone}` : `email:${email}`), null);
    }
  }
});

test("HTTP delivery timeout aborts the request and leaves the challenge inactive", async () => {
  for (const channel of ["sms", "email"] as const) {
    const store = new InMemoryOtpStore();
    let aborted = false;
    const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      const watchdog = setTimeout(() => reject(new Error("test watchdog")), 1000);
      init!.signal!.addEventListener("abort", () => { aborted = true; clearTimeout(watchdog); reject(new Error("aborted")); }, { once: true });
    });
    if (channel === "sms") await assert.rejects(new SendBuyerPhoneCodeUseCase(store, sender(channel, fetcher, 10)).execute({ phone }), unavailable);
    else await assert.rejects(new SendBuyerEmailCodeUseCase(store, sender(channel, fetcher, 10)).execute({ email }), unavailable);
    assert.equal(aborted, true);
    assert.equal(await store.findActive(channel === "sms" ? `BR:${phone}` : `email:${email}`), null);
  }
});

test("failed resend preserves the previously delivered code, expiry and attempt limit", async () => {
  for (const channel of ["sms", "email"] as const) {
    const store = new InMemoryOtpStore();
    const key = channel === "sms" ? `BR:${phone}` : `email:${email}`;
    await store.save({ phone: key, codeHash: hash("765432"), maxAttempts: 5, expiresAt: new Date(Date.now() + 60000) });
    await store.incrementAttempts(key);
    const before = await store.findActive(key);
    const fetcher: typeof fetch = async () => new Response("rejected", { status: 500 });
    if (channel === "sms") await assert.rejects(new SendBuyerPhoneCodeUseCase(store, sender(channel, fetcher)).execute({ phone }), unavailable);
    else await assert.rejects(new SendBuyerEmailCodeUseCase(store, sender(channel, fetcher)).execute({ email }), unavailable);
    assert.deepEqual(await store.findActive(key), before);
  }
});

test("successful provider acceptance activates a hashed OTP that verifies once, without logging secrets or PII", async (t) => {
  const logs: unknown[][] = [];
  for (const method of ["log", "warn", "error", "debug"] as const) t.mock.method(Logger.prototype, method, (...args: unknown[]) => logs.push(args));
  t.mock.method(console, "warn", (...args: unknown[]) => logs.push(args));
  const codes: string[] = [];
  for (const channel of ["sms", "email"] as const) {
    const store = new InMemoryOtpStore();
    const key = channel === "sms" ? `BR:${phone}` : `email:${email}`;
    const fetcher: typeof fetch = async (_url, init) => {
      assert.equal(await store.findActive(key), null, "challenge is inactive until provider acceptance");
      const body = JSON.parse(init!.body as string);
      if (channel === "sms") assert.equal(body.jid, `${phone}@s.whatsapp.net`);
      else assert.equal(body.to, email);
      const code = (body.message ?? body.text).match(/\d{6}/)![0];
      codes.push(code);
      return new Response("accepted", { status: 202 });
    };
    const sent = channel === "sms"
      ? await new SendBuyerPhoneCodeUseCase(store, sender(channel, fetcher)).execute({ phone })
      : await new SendBuyerEmailCodeUseCase(store, sender(channel, fetcher)).execute({ email });
    const code = codes.at(-1)!;
    assert.equal(sent.sent, true);
    assert.equal("dev_code" in sent, false);
    assert.equal(JSON.stringify(sent).includes(code), false);
    assert.equal((await store.findActive(key))?.codeHash, hash(code));
    if (channel === "sms") {
      const verify = new VerifyBuyerPhoneCodeUseCase(new InMemoryBuyerAccountRepository(), store, new BuyerJwtService("buyer-test-secret", 3600));
      assert.ok((await verify.execute({ phone, code })).accessToken);
      await assert.rejects(verify.execute({ phone, code }));
    } else {
      const verify = new VerifyBuyerEmailCodeUseCase(store);
      assert.equal((await verify.execute({ email, code })).verified, true);
      await assert.rejects(verify.execute({ email, code }));
    }
    assert.equal(await store.findActive(key), null);
  }
  // Provider error strings and bodies can echo sensitive data; neither may reach logs.
  const errorCode = "111222";
  await assert.rejects(sender("sms", async () => { throw new Error(`${phone} ${email} ${errorCode}`); }).send(phone, errorCode));
  const logged = JSON.stringify(logs);
  for (const secret of [phone, email, errorCode, ...codes]) assert.equal(logged.includes(secret), false);
  assert.ok(logged.includes("buyer_otp.delivery_failed"));
});

test("OTP stores do not log identifiers or malformed payloads", async (t) => {
  const logs: unknown[][] = [];
  for (const method of ["log", "warn", "error", "debug"] as const) t.mock.method(Logger.prototype, method, (...args: unknown[]) => logs.push(args));
  t.mock.method(console, "warn", (...args: unknown[]) => logs.push(args));
  const data = { phone: `email:${email}`, codeHash: hash("123456"), maxAttempts: 5, attempts: 0, expiresAt: new Date(Date.now() + 60000), consumedAt: null };
  const prisma = new PrismaOtpStore({ buyerPhoneOtp: { async findUnique() { return data; } } } as never);
  assert.ok(await prisma.findActive(data.phone));
  const redis = new RedisOtpStore({ async get() { return `invalid ${phone} ${email} 123456`; }, async del() {} } as never);
  assert.equal(await redis.findActive(data.phone), null);
  const logged = JSON.stringify(logs);
  for (const secret of [phone, email, "123456", data.codeHash]) assert.equal(logged.includes(secret), false);
});

test("email verification enforces max attempts even when the next supplied code is correct", async () => {
  const store = new InMemoryOtpStore();
  await store.save({ phone: `email:${email}`, codeHash: hash("765432"), maxAttempts: 5, expiresAt: new Date(Date.now() + 60000) });
  const verify = new VerifyBuyerEmailCodeUseCase(store);
  for (let i = 0; i < 5; i++) await assert.rejects(verify.execute({ email, code: "000000" }), /otp_invalid/);
  await assert.rejects(verify.execute({ email, code: "765432" }), /otp_locked/);
});
