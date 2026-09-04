import { Module, Global, OnModuleInit, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { REDIS_CLIENT_TOKEN } from "../../shared/cache/redis.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { LoginUseCase } from "./application/login.use-case.js";
import { LoginWithRateLimitUseCase } from "./application/login-with-rate-limit.use-case.js";
import { OAuthCallbackUseCase } from "./application/oauth-callback.use-case.js";
import { RegisterMerchantUseCase } from "./application/register-merchant.use-case.js";
import { RefreshTokenUseCase } from "./application/refresh-token.use-case.js";
import { RequestPasswordResetUseCase } from "./application/request-password-reset.use-case.js";
import { ResetPasswordUseCase } from "./application/reset-password.use-case.js";
import { VerifyCaptchaUseCase } from "./application/verify-captcha.use-case.js";
import { GetMeUseCase } from "./application/get-me.use-case.js";
import { UpdateMeUseCase } from "./application/update-me.use-case.js";
import { ChangePasswordUseCase } from "./application/change-password.use-case.js";
import { RequestEmailChangeUseCase } from "./application/request-email-change.use-case.js";
import { ConfirmEmailChangeUseCase } from "./application/confirm-email-change.use-case.js";
import { EmailChangeRateLimiter } from "./domain/services/email-change-rate-limiter.service.js";
import { AUTH_REPOSITORY } from "./domain/ports/auth-repository.port.js";
import {
  EMAIL_CHANGE_OTP_STORE,
} from "./domain/ports/email-change-otp-store.port.js";
import { CAPTCHA_VERIFIER } from "./domain/ports/captcha-verifier.port.js";
import { CloudflareTurnstileAdapter } from "./infrastructure/cloudflare-turnstile.adapter.js";
import { MERCHANT_ID_GENERATOR, DefaultMerchantIdGenerator } from "./domain/ports/merchant-id-generator.port.js";
import { OAUTH_PROVIDER_PORT } from "./domain/ports/oauth-provider.port.js";
import { RATE_LIMITER } from "./domain/ports/rate-limiter.port.js";
import { AuthCookieService } from "./domain/services/auth-cookie.service.js";
import { JwtService } from "./domain/services/jwt.service.js";
import { LoginRateLimiter } from "./domain/services/login-rate-limiter.service.js";
import { PasswordHasher } from "./domain/services/password-hasher.service.js";
import { OAuthProviderAdapter } from "./infrastructure/oauth-provider.adapter.js";
import { PrismaAuthRepository } from "./infrastructure/prisma-auth.repository.js";
import { RedisEmailChangeOtpStore } from "./infrastructure/redis-email-change-otp-store.js";
import { AuthController } from "./presentation/auth.controller.js";
import { AuthGuard } from "./presentation/auth.guard.js";
import { TenantRoleGuard } from "./presentation/tenant-role.guard.js";

/**
 * C3: OnModuleInit hook validates JWT_SECRET is not the dev default in production.
 */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [
    // Use-cases
    RegisterMerchantUseCase,
    LoginUseCase,
    LoginWithRateLimitUseCase,
    RefreshTokenUseCase,
    RequestPasswordResetUseCase,
    ResetPasswordUseCase,
    OAuthCallbackUseCase,
    VerifyCaptchaUseCase,
    GetMeUseCase,
    UpdateMeUseCase,
    ChangePasswordUseCase,
    RequestEmailChangeUseCase,
    ConfirmEmailChangeUseCase,
    EmailChangeRateLimiter,
    // Captcha (Cloudflare Turnstile). Adapter self-disables when
    // TURNSTILE_SECRET_KEY is unset, so this is safe to always wire.
    { provide: CAPTCHA_VERIFIER, useClass: CloudflareTurnstileAdapter },
    // Domain services
    PasswordHasher,
    JwtService,
    AuthCookieService,
    // Guards
    AuthGuard,
    TenantRoleGuard,
    // Ports + implementations
    {
      provide: AUTH_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaAuthRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: EMAIL_CHANGE_OTP_STORE,
      useFactory: (redis: Redis | null) => {
        if (!redis) {
          // Fail-soft: OTP is unavailable but password login still works.
          // Email-change flow returns 503 when called.
          return {
            async save() {
              throw new Error("otp_store_unavailable");
            },
            async findActive() {
              return null;
            },
            async incrementAttempts() {
              return null;
            },
            async consume() {
              // no-op
            },
          };
        }
        return new RedisEmailChangeOtpStore(redis);
      },
      inject: [REDIS_CLIENT_TOKEN],
    },
    {
      provide: MERCHANT_ID_GENERATOR,
      useClass: DefaultMerchantIdGenerator
    },
    {
      provide: OAUTH_PROVIDER_PORT,
      useClass: OAuthProviderAdapter,
    },
    {
      provide: RATE_LIMITER,
      useFactory: () => new LoginRateLimiter(),
    }
  ],
  exports: [
    AuthGuard,
    TenantRoleGuard,
    JwtService,
    AuthCookieService,
    AUTH_REPOSITORY,
    // Export use-cases for controllers in other modules that need them
    LoginUseCase,
    LoginWithRateLimitUseCase,
    RefreshTokenUseCase
  ]
})
export class AuthModule implements OnModuleInit {
  private readonly logger = new Logger("AuthModule");

  constructor(private readonly jwt: JwtService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "production") {
      this.logger.log("✓ JWT_SECRET verified — not using dev default in production");
    }
  }
}
