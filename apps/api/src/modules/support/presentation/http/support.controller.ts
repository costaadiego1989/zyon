import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import {
  Body,
  Controller,
  Get,
  Inject,
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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
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
  PublicSupportChatDto,
  SupportChatDto,
  UpdateSupportSettingsDto,
  UpdateSupportTicketDto,
} from "./support.dto.js";
import { DEFAULT_SUPPORT_FAQ } from "../../domain/defaults/support-faq.defaults.js";

type EmbedRequest = { embedClaims?: EmbedTokenClaims; headers?: { origin?: string } };

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
    @Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
  ) {}

  /**
   * P0 fix: chat now requires a verified embed token. `merchant_id` is derived
   * from the token — it is never trusted from the request body.
   * P1 fix: body is a validated DTO (`SupportChatDto`) — no interface pass-through.
   */
  @ApiOperation({
    summary: "Send support chat message",
    description:
      "Send a message to support chat. Requires valid embed token. Returns AI-generated or rule-engine-approved response.",
  })
  @ApiResponse({
    status: 200,
    description: "Chat message sent and response generated",
    schema: {
      example: {
        message: "Here is some information about that...",
        suggested_actions: [],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Invalid message body or session ID",
  })
  @ApiResponse({
    status: 401,
    description: "Invalid or missing embed token",
  })
  @UseGuards(EmbedAuthGuard)
  @Post("chat")
  async chat(@Req() request: EmbedRequest, @Body() body: SupportChatDto) {
    const merchantId = request.embedClaims!.merchantId;
    const settings = await this.getSettings.execute(merchantId);
    const faqItems = settings.faqItems.length > 0 ? settings.faqItems : DEFAULT_SUPPORT_FAQ;
    const result = await this.sendSupportMessage.execute(
      { merchant_id: merchantId, session_id: body.session_id, message: body.message },
      { faqItems, brandName: request.embedClaims!.merchantId, buyerGlobalUserId: body.buyer_global_user_id },
    );
    if (!result.handoff) return result;
    // execute() creates a NEW ticket; client-provided session_id is never an access credential.
    const access = this.capabilities.issue({
      purpose: "support-ticket", merchantId, resourceId: result.handoff.ticketId,
      origin: request.headers?.origin,
    });
    return { ...result, handoff: { ...result.handoff, accessToken: access.token, expiresAt: access.expiresAt } };
  }

  /**
   * P0 fix: FAQ now requires a verified embed token. `merchant_id` query param
   * is ignored — tenant is derived from the token.
   */
  @ApiOperation({
    summary: "Get FAQ items",
    description:
      "Retrieve FAQ items configured for this merchant. Requires valid embed token.",
  })
  @ApiResponse({
    status: 200,
    description: "FAQ items retrieved",
    schema: {
      example: {
        faqItems: [
          {
            question: "What is your return policy?",
            answer: "Returns accepted within 30 days...",
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Invalid or missing embed token",
  })
  @UseGuards(EmbedAuthGuard)
  @Get("faq")
  async getFaq(@Req() request: EmbedRequest) {
    const merchantId = request.embedClaims!.merchantId;
    const settings = await this.getSettings.execute(merchantId);
    const faqItems = settings.faqItems.length > 0 ? settings.faqItems : DEFAULT_SUPPORT_FAQ;
    return { faqItems };
  }

  @ApiOperation({ summary: "Get FAQ by merchant ID (public, no auth)" })
  @Get("faq/public")
  async getFaqPublic(@Query("merchantId") merchantId: string) {
    if (!merchantId) return { faqItems: DEFAULT_SUPPORT_FAQ };
    const settings = await this.getSettings.execute(merchantId);
    const faqItems = settings.faqItems.length > 0 ? settings.faqItems : DEFAULT_SUPPORT_FAQ;
    return { faqItems };
  }

  @ApiOperation({ summary: "Public support chat (storefront, no embed token)" })
  @ApiResponse({ status: 200, description: "AI reply based on merchant FAQ knowledge" })
  @Post("chat/public")
  async chatPublic(@Body() body: PublicSupportChatDto) {
    const merchantId = body.merchant_id;
    const settings = await this.getSettings.execute(merchantId);
    const faqItems = settings.faqItems.length > 0 ? settings.faqItems : DEFAULT_SUPPORT_FAQ;
    return this.sendSupportMessage.execute(
      { merchant_id: merchantId, session_id: body.session_id, message: body.message },
      { faqItems, brandName: merchantId, buyerGlobalUserId: body.buyer_global_user_id },
    );
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @ApiOperation({
    summary: "Get support settings",
    description:
      "Retrieve support configuration for merchant. Includes FAQ items and routing rules.",
  })
  @ApiResponse({
    status: 200,
    description: "Support settings retrieved",
    schema: {
      example: {
        merchantId: "merch_123",
        faqItems: [],
        enabled: true,
        createdAt: "2026-08-10T00:00:00Z",
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Missing support:read scope",
  })
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:read"] })
  @Get("settings")
  getSettings_(@Req() request: unknown) {
    return this.getSettings.execute(tenantId(request));
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @ApiOperation({
    summary: "Update support settings",
    description:
      "Update support configuration including FAQ items. Requires idempotency key.",
  })
  @ApiResponse({
    status: 200,
    description: "Support settings updated",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid settings body",
  })
  @ApiResponse({
    status: 403,
    description: "Missing support:write scope",
  })
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
  @ApiOperation({
    summary: "List support tickets",
    description:
      "List support tickets with pagination. Supports filtering by status and cursor-based pagination.",
  })
  @ApiResponse({
    status: 200,
    description: "Support tickets retrieved",
    schema: {
      example: {
        data: [
          {
            id: "ticket_123",
            status: "open",
            createdAt: "2026-08-10T00:00:00Z",
          },
        ],
        next_cursor: "cursor_next",
        has_more: true,
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: "Missing support:read scope",
  })
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:read"], humanRoles: ["owner", "admin", "staff"] })
  @Get("tickets")
  @RequireTenantRoles("owner", "admin", "staff")
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
  @ApiOperation({
    summary: "Create a support ticket",
    description:
      "Create a new support ticket associated with a session. Requires idempotency key.",
  })
  @ApiResponse({
    status: 201,
    description: "Support ticket created",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid ticket body",
  })
  @ApiResponse({
    status: 403,
    description: "Missing support:write scope",
  })
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:write"] })
  @Post("tickets")
  @RequireTenantRoles("owner", "admin", "staff")
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
  @ApiOperation({
    summary: "Update support ticket status",
    description:
      "Transition a support ticket to a new status (open, in_progress, resolved, closed). Requires idempotency key.",
  })
  @ApiResponse({
    status: 200,
    description: "Ticket status updated",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid status transition",
  })
  @ApiResponse({
    status: 403,
    description: "Missing support:write scope",
  })
  @ApiResponse({
    status: 404,
    description: "Ticket not found",
  })
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:write"], humanRoles: ["owner", "admin", "staff"] })
  @Patch("tickets/:ticketId")
  @RequireTenantRoles("owner", "admin", "staff")
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
