import { Body, ConflictException, Controller, Delete, Get, HttpException, Logger, Param, Patch, Post, Put, Query, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { PlatformAccessGuard } from "../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../platform-control/presentation/platform-principal.js";
import { BillingPromotionsService } from "./billing-promotions.service.js";
import { Prisma } from "@prisma/client";

@Controller("platform/billing/promotions")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
export class BillingPromotionsController {
  private readonly logger = new Logger(BillingPromotionsController.name);
  constructor(private readonly promotions: BillingPromotionsService) {}

  @Get()
  @RequirePlatformPermissions("platform:billing:read")
  list(@Query() query: Record<string, unknown>) { return this.handle(() => this.promotions.list(query)); }

  @Post()
  @RequirePlatformPermissions("platform:billing-promotions:write")
  create(@Body() body: Record<string, unknown>, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.handle(() => this.promotions.create(body, this.context(request)));
  }

  @Patch(":id")
  @RequirePlatformPermissions("platform:billing-promotions:write")
  toggle(@Param("id") id: string, @Body() body: { enabled?: unknown }, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.handle(() => this.promotions.setEnabled(id, body.enabled, this.context(request)));
  }

  @Post(":id/retry")
  @RequirePlatformPermissions("platform:billing-promotions:write")
  retry(@Param("id") id: string, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.handle(() => this.promotions.retry(id, this.context(request)));
  }

  @Put(":id")
  @RequirePlatformPermissions("platform:billing-promotions:write")
  update(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.handle(() => this.promotions.update(id, body, this.context(request)));
  }

  @Delete(":id")
  @RequirePlatformPermissions("platform:billing-promotions:write")
  remove(@Param("id") id: string, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.handle(() => this.promotions.remove(id, this.context(request)));
  }

  private context(request: PlatformPrincipalRequest & { correlationId?: string }) {
    return { operatorId: currentPlatformPrincipal(request).operatorId, correlationId: request.correlationId ?? crypto.randomUUID() };
  }
  private async handle<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({ code: "billing_promotion_code_exists", detail: "Este código já existe. Escolha outro." });
      }
      this.logger.error("billing_promotion_provider_or_persistence_failed");
      throw new ServiceUnavailableException({ code: "billing_promotion_provider_failed", detail: "Não foi possível sincronizar com a Stripe. Tente novamente; os dados do formulário foram mantidos." });
    }
  }
}
