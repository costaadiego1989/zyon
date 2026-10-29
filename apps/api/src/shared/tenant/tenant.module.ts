import { Global, Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { TenantContextService } from "./tenant-context.service.js";
import { TenantGuard } from "./tenant.guard.js";
import { TenantInterceptor } from "./tenant.interceptor.js";

@Global()
@Module({
  providers: [
    TenantContextService,
    TenantGuard,
    TenantInterceptor,
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
  exports: [TenantContextService],
})
export class TenantModule {}
