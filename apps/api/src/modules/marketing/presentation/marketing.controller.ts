import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  AuthGuard,
  RequireTenantRoles,
  TenantRoleGuard,
} from "../../auth/public-api.js";
import {
  currentTenantPrincipal,
  type TenantPrincipalRequest,
} from "../../../shared/auth/tenant-principal.js";
import { MarketingContactsService } from "../application/marketing-contacts.service.js";
import { MarketingConversationsService } from "../application/marketing-conversations.service.js";
import { MarketingCampaignsService } from "../application/marketing-campaigns.service.js";
import { MarketingLifecycleService } from "../application/marketing-lifecycle.service.js";
import {
  MarketingExceptionFilter,
  MarketingHttpInterceptor,
  MarketingPlanGuard,
} from "./marketing-http.js";
import {
  MarketingCampaignDto,
  MarketingContactQueryDto,
  MarketingOwnershipDto,
  MarketingReplyDto,
  MarketingScheduleDto,
  MarketingSettingsDto,
  MarketingStageDto,
  MarketingUpdateCampaignDto,
  MarketingVersionDto,
} from "./marketing.dto.js";
import {
  MarketingConversationQueryDto,
  MarketingMessagesQueryDto,
} from "./marketing.dto.js";
import { SetMetadata } from "@nestjs/common";
import { MARKETING_ACCESS_PROBE } from "./marketing-http.js";

@ApiTags("marketing")
@ApiBearerAuth()
@Controller("marketing")
@RequireTenantRoles("owner", "admin", "staff")
@UseGuards(AuthGuard, TenantRoleGuard, MarketingPlanGuard)
@UseFilters(MarketingExceptionFilter)
@UseInterceptors(MarketingHttpInterceptor)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
)
export class MarketingController {
  constructor(
    private readonly contacts: MarketingContactsService,
    private readonly conversations: MarketingConversationsService,
    private readonly campaigns: MarketingCampaignsService,
    private readonly lifecycle: MarketingLifecycleService
  ) {}
  private actor(request: TenantPrincipalRequest) {
    const actor = currentTenantPrincipal(request);
    if (actor.kind !== "human")
      throw new ForbiddenException("marketing_human_required");
    return actor;
  }
  @Get("access")
  @SetMetadata(MARKETING_ACCESS_PROBE, true)
  access(@Req() request: TenantPrincipalRequest) {
    return this.contacts.access(this.actor(request).tenantId);
  }
  @Get("contacts")
  @ApiOperation({
    summary: "List all identified store contacts with server-side filters",
  })
  listContacts(
    @Req() request: TenantPrincipalRequest,
    @Query() query: MarketingContactQueryDto
  ) {
    return this.contacts.list(this.actor(request).tenantId, query);
  }
  @Get("funnel")
  funnel(@Req() request: TenantPrincipalRequest) {
    return this.contacts.funnel(this.actor(request).tenantId);
  }
  @Get("contacts/:id")
  @ApiOperation({ summary: "Read contact metrics, consent and stage history" })
  contact(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.contacts.detail(this.actor(request).tenantId, id);
  }
  @Patch("contacts/:id/stage")
  move(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: MarketingStageDto
  ) {
    const actor = this.actor(request);
    return this.contacts.move(
      actor.tenantId,
      id,
      body.stage,
      body.reason,
      actor.userId,
      body.version
    );
  }
  @Post("contacts/:id/opt-out")
  revoke(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    const actor = this.actor(request);
    return this.contacts.revoke(actor.tenantId, id, `agent:${actor.userId}`);
  }
  @Get("conversations")
  @ApiOperation({
    summary: "Read site and WhatsApp conversations owned by this store",
  })
  listConversations(
    @Req() request: TenantPrincipalRequest,
    @Query() query: MarketingConversationQueryDto
  ) {
    const actor = this.actor(request);
    return this.conversations.list(actor.tenantId, query.limit, query.offset, {
      channel: query.channel,
      mode: query.mode,
      search: query.search,
      ...(query.assignment
        ? { assignedUserId: query.assignment === "mine" ? actor.userId : null }
        : {}),
    });
  }
  @Get("conversations/:id")
  conversation(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: MarketingMessagesQueryDto
  ) {
    return this.conversations.detail(
      this.actor(request).tenantId,
      id,
      query.before
    );
  }
  @Post("conversations/:id/ownership")
  ownership(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: MarketingOwnershipDto
  ) {
    const actor = this.actor(request);
    return this.conversations.ownership(
      actor.tenantId,
      id,
      actor.userId,
      body.action,
      body.version
    );
  }
  @Post("conversations/:id/messages")
  reply(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: MarketingReplyDto
  ) {
    const actor = this.actor(request);
    return this.conversations.reply(
      actor.tenantId,
      id,
      actor.userId,
      body.content,
      body.requestId,
      body.version
    );
  }
  @Get("campaigns")
  @RequireTenantRoles("owner", "admin")
  listCampaigns(@Req() request: TenantPrincipalRequest) {
    return this.campaigns.list(this.actor(request).tenantId);
  }
  @Post("campaigns")
  @RequireTenantRoles("owner", "admin")
  @ApiOperation({
    summary: "Create a campaign draft; does not dispatch messages",
  })
  create(
    @Req() request: TenantPrincipalRequest,
    @Body() body: MarketingCampaignDto
  ) {
    const actor = this.actor(request);
    return this.campaigns.create(actor.tenantId, actor.role, body);
  }
  @Get("campaigns/:id")
  @RequireTenantRoles("owner", "admin")
  campaign(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.campaigns.get(this.actor(request).tenantId, id);
  }
  @Patch("campaigns/:id")
  @RequireTenantRoles("owner", "admin")
  update(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: MarketingUpdateCampaignDto
  ) {
    const actor = this.actor(request);
    return this.campaigns.update(
      actor.tenantId,
      actor.role,
      id,
      body.version,
      body
    );
  }
  @Post("campaigns/:id/template")
  @RequireTenantRoles("owner", "admin")
  submitTemplate(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    const actor = this.actor(request);
    return this.campaigns.submitTemplate(actor.tenantId, actor.role, id);
  }
  @Post("campaigns/:id/template/sync")
  @RequireTenantRoles("owner", "admin")
  syncTemplate(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    const actor = this.actor(request);
    return this.campaigns.syncTemplate(actor.tenantId, actor.role, id);
  }
  @Get("campaigns/:id/review")
  @RequireTenantRoles("owner", "admin")
  review(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.campaigns.review(this.actor(request).tenantId, id);
  }
  @Post("campaigns/:id/approve")
  @RequireTenantRoles("owner", "admin")
  approve(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: MarketingVersionDto
  ) {
    const actor = this.actor(request);
    return this.campaigns.approve(
      actor.tenantId,
      actor.role,
      id,
      body.version,
      actor.userId
    );
  }
  @Post("campaigns/:id/schedule")
  @RequireTenantRoles("owner", "admin")
  schedule(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: MarketingScheduleDto
  ) {
    const actor = this.actor(request);
    return this.campaigns.schedule(
      actor.tenantId,
      actor.role,
      id,
      body.scheduledAt ?? null
    );
  }
  @Post("campaigns/:id/pause")
  @RequireTenantRoles("owner", "admin")
  pause(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    const actor = this.actor(request);
    return this.campaigns.pause(actor.tenantId, actor.role, id);
  }
  @Get("campaigns/:id/report")
  @RequireTenantRoles("owner", "admin")
  report(
    @Req() request: TenantPrincipalRequest,
    @Param("id", new ParseUUIDPipe()) id: string
  ) {
    return this.campaigns.report(this.actor(request).tenantId, id);
  }
  @Get("settings")
  settings(@Req() request: TenantPrincipalRequest) {
    return this.campaigns.settings(this.actor(request).tenantId);
  }
  @Patch("settings")
  @RequireTenantRoles("owner", "admin")
  configure(
    @Req() request: TenantPrincipalRequest,
    @Body() body: MarketingSettingsDto
  ) {
    const actor = this.actor(request);
    return this.campaigns.configure(actor.tenantId, actor.role, body);
  }
  @Get("history")
  @RequireTenantRoles("owner", "admin")
  history(@Req() request: TenantPrincipalRequest) {
    return this.lifecycle.status(this.actor(request).tenantId);
  }
  @Post("history")
  @RequireTenantRoles("owner", "admin")
  importHistory(@Req() request: TenantPrincipalRequest) {
    const actor = this.actor(request);
    return this.lifecycle.start(actor.tenantId, actor.role);
  }
  @Get("retention")
  @RequireTenantRoles("owner", "admin")
  retention(@Req() request: TenantPrincipalRequest) {
    return this.lifecycle.retentionPreview(this.actor(request).tenantId);
  }
}
