import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { RequireTenantRoles } from "../../auth/presentation/tenant-role.decorator.js";
import type { TenantPrincipalRequest } from "../../../shared/auth/tenant-principal.js";
import { FiscalConnectionService } from "../application/fiscal-connection.service.js";
import { FiscalProfileService } from "../application/fiscal-profile.service.js";
import { FiscalSetupService } from "../application/fiscal-setup.service.js";
import type { FiscalConnectionInput } from "../domain/fiscal-configuration.port.js";
import type { FiscalProfileDraft } from "../domain/fiscal-profile.port.js";
import { fiscalHttp, fiscalHttpActor } from "./fiscal-http.js";
@RequireTenantRoles("owner", "admin")
@UseGuards(AuthGuard, TenantRoleGuard)
@Controller("merchants/me/fiscal")
export class FiscalConfigurationController {
  constructor(
    private readonly connections: FiscalConnectionService,
    private readonly profiles: FiscalProfileService,
    private readonly setup: FiscalSetupService
  ) {}
  @Get("providers") providers(
    @Req() req: TenantPrincipalRequest,
    @Query("environment") environment: string
  ) {
    const ctx = fiscalHttpActor(req, environment);
    return {
      environment: ctx.scope.environment,
      providers: this.connections.providers(),
    };
  }
  @Get("payment-sources") paymentSources(@Req() req: TenantPrincipalRequest, @Query("environment") environment: string, @Query("intentId") intentId?: string) {
    const { scope } = fiscalHttpActor(req, environment); return fiscalHttp(() => this.setup.paymentSources(scope, intentId));
  }
  @Get("connection") connection(
    @Req() req: TenantPrincipalRequest,
    @Query("environment") environment: string
  ) {
    const ctx = fiscalHttpActor(req, environment);
    return fiscalHttp(() => this.connections.current(ctx.scope));
  }
  @Put("connection") connect(
    @Req() req: TenantPrincipalRequest,
    @Body() body: FiscalConnectionInput
  ) {
    const ctx = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() =>
      this.connections.connect(
        {
          merchantId: ctx.scope.merchantId,
          environment: ctx.scope.environment,
          provider: body.provider,
          issuerTaxId: body.issuerTaxId,
          credential: body.credential,
          erpConnectionId: body.erpConnectionId,
          stockOwner: body.stockOwner,
          emailOwner: body.emailOwner,
          whatsappOwner: body.whatsappOwner,
        },
        ctx.actor
      )
    );
  }
  @Post("connection/:id/inspect") inspect(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Body() body: { environment: string }
  ) {
    const ctx = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() => this.connections.inspect(ctx.scope, id));
  }
  @Post("connection/:id/activate") activate(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Body() body: { environment: string }
  ) {
    const ctx = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() =>
      this.connections.activate(ctx.scope, id, ctx.actor)
    );
  }
  @Delete("connection/:id") disconnect(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Query("environment") environment: string
  ) {
    const ctx = fiscalHttpActor(req, environment);
    return fiscalHttp(() =>
      this.connections.disconnect(ctx.scope, id, ctx.actor)
    );
  }
  @Post("connection/:id/reconnect") reconnect(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Body()
    body: {
      environment: string;
      credential?: FiscalConnectionInput["credential"];
    }
  ) {
    const ctx = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() =>
      this.connections.reconnect(ctx.scope, id, body.credential, ctx.actor)
    );
  }
  @Get("connection/:id/setup") readSetup(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Query("environment") environment: string
  ) {
    const ctx = fiscalHttpActor(req, environment);
    return fiscalHttp(() => this.setup.publicRead(ctx.scope, id));
  }
  @Put("connection/:id/setup") saveSetup(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Body()
    body: {
      environment: string;
      companyId?: unknown;
      fiscalTimeZone?: unknown;
      focusWebhook?: unknown;
      accountConfiguration?: unknown;
      paymentConfiguration?: unknown;
    }
  ) {
    const ctx = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() =>
      this.setup.save(
        ctx.scope,
        id,
        {
          companyId: body.companyId,
          fiscalTimeZone: body.fiscalTimeZone,
          focusWebhook: body.focusWebhook,
          accountConfiguration: body.accountConfiguration,
          paymentConfiguration: body.paymentConfiguration,
        },
        ctx.actor
      )
    );
  }
  @Get("profiles") readProfiles(@Req() req: TenantPrincipalRequest, @Query("environment") environment: string, @Query("provider") provider: string, @Query("operation") operation = "sale") {
    const { scope } = fiscalHttpActor(req, environment); return fiscalHttp(() => this.profiles.read(scope, provider, operation));
  }
  @Post("profiles") draft(
    @Req() req: TenantPrincipalRequest,
    @Body() body: FiscalProfileDraft
  ) {
    const ctx = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() =>
      this.profiles.draft(
        {
          merchantId: ctx.scope.merchantId,
          environment: ctx.scope.environment,
          provider: body.provider,
          operation: body.operation,
          issuerRegime: body.issuerRegime,
          itemRules: body.itemRules,
          recipientRequirements: body.recipientRequirements,
          sourceContractVersion: body.sourceContractVersion,
        },
        ctx.actor
      )
    );
  }
  @Post("profiles/:id/confirm") confirm(
    @Req() req: TenantPrincipalRequest,
    @Param("id") id: string,
    @Body() body: { environment: string }
  ) {
    const ctx = fiscalHttpActor(req, body.environment);
    return fiscalHttp(() => this.profiles.confirm(ctx.scope, id, ctx.actor));
  }
}
