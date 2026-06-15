import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { LoginUseCase } from "./application/login.use-case.js";
import { RegisterMerchantUseCase } from "./application/register-merchant.use-case.js";
import { AUTH_REPOSITORY } from "./domain/ports/auth-repository.port.js";
import { AuthCookieService } from "./domain/services/auth-cookie.service.js";
import { JwtService } from "./domain/services/jwt.service.js";
import { LoginRateLimiter } from "./domain/services/login-rate-limiter.service.js";
import { PasswordHasher } from "./domain/services/password-hasher.service.js";
import { PrismaAuthRepository } from "./infrastructure/prisma-auth.repository.js";
import { AuthController } from "./presentation/auth.controller.js";
import { AuthGuard } from "./presentation/auth.guard.js";
import { TenantRoleGuard } from "./presentation/tenant-role.guard.js";

@Module({
  controllers: [AuthController],
  providers: [
    RegisterMerchantUseCase,
    LoginUseCase,
    PasswordHasher,
    JwtService,
    AuthCookieService,
    LoginRateLimiter,
    AuthGuard,
    TenantRoleGuard,
    {
      provide: AUTH_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaAuthRepository(prisma),
      inject: [PRISMA_CLIENT]
    }
  ],
  exports: [AuthGuard, TenantRoleGuard, JwtService, AuthCookieService, AUTH_REPOSITORY]
})
export class AuthModule {}
