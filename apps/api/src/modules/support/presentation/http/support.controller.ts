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
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import type { EmbedTokenClaims } from "../../../embed/domain/embed-token.service.js";
import { SendSupportMessageUseCase } from "../../application/send-support-message.use-case.js";
import { GetSupportSettingsUseCase } from "../../application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "../../application/list-support-tickets.use-case.js";
import { UpdateSupportSettingsUseCase } from "../../application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "../../application/update-support-ticket-status.use-case.js";
import { CreateSupportTicketUseCase } from "../../application/create-support-ticket.use-case.js";
import {
  CreateSupportTicketDto,
  SupportChatDto,
  UpdateSupportSettingsDto,
  UpdateSupportTicketDto,
} from "./support.dto.js";

type EmbedRequest = { embedClaims?: EmbedTokenClaims };

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

  /**
   * P0 fix: chat now requires a verified embed token. `merchant_id` is derived
   * from the token — it is never trusted from the request body.
   * P1 fix: body is a validated DTO (`SupportChatDto`) — no interface pass-through.
   */
  @UseGuards(EmbedAuthGuard)
  @Post("chat")
  async chat(@Req() request: EmbedRequest, @Body() body: SupportChatDto) {
    const merchantId = request.embedClaims!.merchantId;
    const settings = await this.getSettings.execute(merchantId);
    return this.sendSupportMessage.execute(
      { merchant_id: merchantId, session_id: body.session_id, message: body.message },
      { faqItems: settings.faqItems },
    );
  }

  /**
   * P0 fix: FAQ now requires a verified embed token. `merchant_id` query param
   * is ignored — tenant is derived from the token.
   */
  @UseGuards(EmbedAuthGuard)
  @Get("faq")
  async getFaq(@Req() request: EmbedRequest) {
    const merchantId = request.embedClaims!.merchantId;
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

  /**
   * P2 fix: real keyset pagination — `has_more` and `next_cursor` are now
   * computed from actual query results, not hardcoded to false/null.
   */
  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:read"] })
  @Get("tickets")
  async getTickets(
    @Req() request: unknown,
    @Query("status") status?: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursor?: string,
  ) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
    return this.listTickets.execute(
      tenantId(request),
      status,
      Number.isFinite(limit) ? limit : undefined,
      cursor,
    );
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
