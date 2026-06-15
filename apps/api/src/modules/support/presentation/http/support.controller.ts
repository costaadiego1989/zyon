import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiTags,
} from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import {
  SendSupportMessageUseCase,
  type SupportMessageInput,
} from "../../application/send-support-message.use-case.js";
import { GetSupportSettingsUseCase } from "../../application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "../../application/list-support-tickets.use-case.js";
import { UpdateSupportSettingsUseCase } from "../../application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "../../application/update-support-ticket-status.use-case.js";
import { CreateSupportTicketUseCase } from "../../application/create-support-ticket.use-case.js";
import {
  CreateSupportTicketDto,
  UpdateSupportSettingsDto,
  UpdateSupportTicketDto,
} from "./support.dto.js";

@ApiTags("Support")
@Controller("support")
export class SupportController {
  constructor(
    private readonly sendSupportMessage: SendSupportMessageUseCase,
    private readonly getSettings: GetSupportSettingsUseCase,
    private readonly updateSettings: UpdateSupportSettingsUseCase,
    private readonly listTickets: ListSupportTicketsUseCase,
    private readonly updateTicketStatus: UpdateSupportTicketStatusUseCase,
    private readonly createTicket: CreateSupportTicketUseCase,
  ) {}

  @Post("chat")
  async chat(@Body() body: SupportMessageInput) {
    const settings = await this.getSettings.execute(body.merchant_id);
    return this.sendSupportMessage.execute(body, {
      faqItems: settings.faqItems,
    });
  }

  @Get("faq")
  async getFaq(@Query("merchant_id") merchantId: string) {
    const settings = await this.getSettings.execute(merchantId);
    return { faqItems: settings.faqItems };
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:read"] })
  @Get("settings")
  getSettings_(@Req() request: unknown) {
    return this.getSettings.execute(tenantId(request));
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:write"] })
  @Put("settings")
  @Idempotent()
  updateSettings_(
    @Req() request: unknown,
    @Body() body: UpdateSupportSettingsDto,
  ) {
    return this.updateSettings.execute(
      tenantId(request),
      body,
    );
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:read"] })
  @Get("tickets")
  async getTickets(
    @Req() request: unknown,
    @Query("status") status?: string,
  ) {
    return {
      data: await this.listTickets.execute(tenantId(request), status),
      next_cursor: null,
      has_more: false,
    };
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:write"] })
  @Post("tickets")
  @Idempotent()
  createTicket_(
    @Req() request: unknown,
    @Body() body: CreateSupportTicketDto,
  ) {
    return this.createTicket.execute({
      merchantId: tenantId(request),
      sessionId: body.session_id,
      message: body.message,
    });
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:write"] })
  @Patch("tickets/:ticketId")
  @Idempotent()
  updateTicket(
    @Req() request: unknown,
    @Param("ticketId") ticketId: string,
    @Body() body: UpdateSupportTicketDto,
  ) {
    return this.updateTicketStatus.execute(
      tenantId(request),
      ticketId,
      body.status,
    );
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}
