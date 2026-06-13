import { Module, forwardRef } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { LoginUseCase } from "./application/login.use-case.js";
import { RegisterMerchantUseCase } from "./application/register-merchant.use-case.js";
import { AUTH_REPOSITORY } from "./domain/ports/auth-repository.port.js";
import { AuthCookieService } from "./domain/services/auth-cookie.service.js";
import { JwtService } from "./domain/services/jwt.service.js";
import { LoginRateLimiter } from "./domain/services/login-rate-limiter.service.js";
import { PasswordHasher } from "./domain/services/password-hasher.service.js";
import { InMemoryAuthRepository } from "./infrastructure/in-memory-auth.repository.js";
import { PrismaAuthRepository } from "./infrastructure/prisma-auth.repository.js";
import { AuthController } from "./presentation/auth.controller.js";
import { AuthGuard } from "./presentation/auth.guard.js";

@Module({
  imports: [forwardRef(() => MerchantModule)],
  controllers: [AuthController],
  providers: [
    RegisterMerchantUseCase,
    LoginUseCase,
    PasswordHasher,
    JwtService,
    AuthCookieService,
    LoginRateLimiter,
    AuthGuard,
    InMemoryAuthRepository,
    {
      provide: AUTH_REPOSITORY,
      useFactory: (inMemory: InMemoryAuthRepository, prisma: PrismaClient) => {
        if (process.env.AUTH_REPOSITORY === "prisma" || process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaAuthRepository(prisma);
        }
        return inMemory;
      },
      inject: [InMemoryAuthRepository, PRISMA_CLIENT]
    }
  ],
  exports: [AuthGuard, JwtService, AuthCookieService, AUTH_REPOSITORY]
})
export class AuthModule {}
