import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { Redis } from "ioredis";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { DefaultMerchantIdGenerator } from "../domain/ports/merchant-id-generator.port.js";
import { PrismaAuthRepository } from "../infrastructure/prisma-auth.repository.js";
import { RedisEmailChangeOtpStore } from "../infrastructure/redis-email-change-otp-store.js";
import { LoginUseCase } from "../application/login.use-case.js";
import { RegisterMerchantUseCase } from "../application/register-merchant.use-case.js";
import { GetMeUseCase } from "../application/get-me.use-case.js";
import { UpdateMeUseCase } from "../application/update-me.use-case.js";
import { ChangePasswordUseCase } from "../application/change-password.use-case.js";
import { RequestEmailChangeUseCase } from "../application/request-email-change.use-case.js";
import { ConfirmEmailChangeUseCase } from "../application/confirm-email-change.use-case.js";
import { EmailChangeRateLimiter } from "../domain/services/email-change-rate-limiter.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthCookieService } from "../domain/services/auth-cookie.service.js";
import type { EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

class FakeEmailSender implements EmailSenderPort {
  public sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(input: { to: string; subject: string; html: string }) {
    this.sent.push(input);
    return { messageId: "msg_1", status: "sent" as const };
  }
}

test(
  "Prisma e2e: GET /auth/me, PUT /auth/me (name+phone), PUT /auth/me/password — full flow",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma tests." },
  async () => {
    const prisma = createPrismaClient();
    const authRepository = new PrismaAuthRepository(prisma);
    const jwt = new JwtService("test-secret-32-chars-long-xxxxxx", 3600);
    const hasher = new PasswordHasher();
    const idGen = new DefaultMerchantIdGenerator();
    const register = new RegisterMerchantUseCase(authRepository, hasher, jwt, idGen);
    const login = new LoginUseCase(authRepository, hasher, jwt);

    const emailSender = new FakeEmailSender();
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const redis = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 });
    const otpStore = new RedisEmailChangeOtpStore(redis);
    const rateLimiter = new EmailChangeRateLimiter(3, 15 * 60 * 1000);

    const authController = new (AuthController as any)(
      register,
      null, // loginWithRateLimit
      null, // refreshToken
      null, // requestPasswordReset
      null, // resetPassword
      null, // oauthCallback
      null, // verifyCaptcha
      new AuthCookieService("aacp_access_token", false),
      new GetMeUseCase(authRepository),
      new UpdateMeUseCase(authRepository),
      new ChangePasswordUseCase(authRepository, hasher),
      new RequestEmailChangeUseCase(authRepository, otpStore, emailSender, rateLimiter),
      new ConfirmEmailChangeUseCase(authRepository, otpStore, emailSender, rateLimiter),
    );

    const merchantEmail = `me_e2e_${crypto.randomUUID()}@example.com`;
    let merchantId = "";
    const originalEmail = merchantEmail;
    const newEmail = `me_e2e_new_${crypto.randomUUID()}@example.com`;

    try {
      // ── Register ──
      const registered = await register.execute({
        merchant_name: "Me Test",
        email: merchantEmail,
        password: "current-pw-123",
      });
      merchantId = registered.merchant_id;
      assert.ok(merchantId, "registered merchant id");

      // ── Seed owner profile (name + phone) directly ──
      await prisma.merchant.update({
        where: { id: merchantId },
        data: {
          storeSettings: {
            owner_name: "Me Test",
            owner_phone: "11999998888",
          } as any,
        },
      });

      // ── Login ──
      const logged = await login.execute({ email: merchantEmail, password: "current-pw-123" });
      assert.ok(logged.access_token, "login returned token");

      // ── GET /auth/me ──
      const me1 = await (authController as any).getMeRoute(merchantId);
      assert.equal(me1.email, merchantEmail);
      assert.equal(me1.name, "Me Test");
      assert.equal(me1.phone, "11999998888");

      // ── PUT /auth/me (name + phone, no email change) ──
      const updated = await (authController as any).updateMeRoute(merchantId, {
        name: "Owner Atualizado",
        phone: "11999998888",
      });
      assert.equal(updated.name, "Owner Atualizado");
      assert.equal(updated.phone, "11999998888");

      const me2 = await (authController as any).getMeRoute(merchantId);
      assert.equal(me2.name, "Owner Atualizado");
      assert.equal(me2.phone, "11999998888");

      // ── PUT /auth/me/password (wrong current) ──
      await assert.rejects(
        () =>
          (authController as any).changePasswordRoute(merchantId, {
            current_password: "wrong-password",
            new_password: "new-pw-12345",
          }),
        (err: any) => err.status === 401,
      );

      // ── PUT /auth/me/password (correct) ──
      const pwResult = await (authController as any).changePasswordRoute(merchantId, {
        current_password: "current-pw-123",
        new_password: "new-pw-12345",
      });
      assert.equal(pwResult.success, true);

      // Verify login works with new password
      const relogin = await login.execute({ email: merchantEmail, password: "new-pw-12345" });
      assert.ok(relogin.access_token);

      // ── Email change: request OTP ──
      const request = await (authController as any).requestEmailChangeRoute(merchantId, {
        new_email: newEmail,
      });
      assert.equal(request.sent, true);
      assert.match(request.delivered_to, /\*\*\*/);
      assert.equal(emailSender.sent.length, 1);
      assert.equal(emailSender.sent[0]!.to, newEmail);
      const codeMatch = emailSender.sent[0]!.html.match(/>(\d{6})</);
      assert.ok(codeMatch, "OTP code embedded in email");
      const code = codeMatch![1]!;

      // ── Email change: confirm wrong code → 401 ──
      await assert.rejects(
        () =>
          (authController as any).confirmEmailChangeRoute(merchantId, {
            new_email: newEmail,
            code: "000000",
          }),
        (err: any) => err.status === 401,
      );

      // ── Email change: confirm correct code → 200 ──
      const confirm = await (authController as any).confirmEmailChangeRoute(merchantId, {
        new_email: newEmail,
        code,
      });
      assert.equal(confirm.email, newEmail);

      // ── Verify email was actually changed in DB ──
      const me3 = await (authController as any).getMeRoute(merchantId);
      assert.equal(me3.email, newEmail);

      // ── Verify notification was sent to OLD email ──
      const oldEmailNotif = emailSender.sent.find((s) => s.to === merchantEmail);
      assert.ok(oldEmailNotif, "notification sent to old email");
      assert.match(oldEmailNotif!.subject, /alterado/i);

      // ── Login with NEW email + NEW password ──
      const finalLogin = await login.execute({ email: newEmail, password: "new-pw-12345" });
      assert.ok(finalLogin.access_token, "login with new email + new password");

      // ── Login with OLD email should fail ──
      await assert.rejects(
        () => login.execute({ email: merchantEmail, password: "new-pw-12345" }),
        (err: any) => err.message?.includes("invalid_credentials") || err.code === "invalid_credentials",
      );
    } finally {
      // Cleanup
      if (merchantId) {
        await prisma.merchantRule.deleteMany({ where: { merchantId } });
        await prisma.merchantUser.deleteMany({ where: { merchantId } });
        await prisma.merchant.deleteMany({ where: { id: merchantId } });
      }
      // Cleanup any user with newEmail (in case of partial state)
      await prisma.merchantUser.deleteMany({ where: { email: newEmail } });
      await prisma.$disconnect();
      await redis.quit();
    }
  },
);
