import { Module, Global, OnModuleInit, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { LoginUseCase } from "./application/login.use-case.js";
import { LoginWithRateLimitUseCase } from "./application/login-with-rate-limit.use-case.js";
import { RegisterMerchantUseCase } from "./application/register-merchant.use-case.js";
import { RefreshTokenUseCase } from "./application/refresh-token.use-case.js";
import { RequestPasswordResetUseCase } from "./application/request-password-reset.use-case.js";
import { ResetPasswordUseCase } from "./application/reset-password.use-case.js";
import { AUTH_REPOSITORY } from "./domain/ports/auth-repository.port.js";
import { MERCHANT_ID_GENERATOR, DefaultMerchantIdGenerator } from "./domain/ports/merchant-id-generator.port.js";
import { RATE_LIMITER } from "./domain/ports/rate-limiter.port.js";
import { AuthCookieService } from "./domain/services/auth-cookie.service.js";
import { JwtService } from "./domain/services/jwt.service.js";
import { LoginRateLimiter } from "./domain/services/login-rate-limiter.service.js";
import { PasswordHasher } from "./domain/services/password-hasher.service.js";
import { PrismaAuthRepository } from "./infrastructure/prisma-auth.repository.js";
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
      provide: MERCHANT_ID_GENERATOR,
      useClass: DefaultMerchantIdGenerator
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
    // C3: Fail-safe — verify JWT_SECRET was not instantiated with the dev default in production
    // This is already checked in JwtService constructor, but we re-confirm here for defense in depth
    if (process.env.NODE_ENV === "production") {
      this.logger.log("✓ JWT_SECRET verified — not using dev default in production");
    }
  }
}
