import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { ReadWhatsAppConversationsUseCase } from "../../application/read-whatsapp-conversations.use-case.js";
import { ClaimWhatsAppConversationUseCase } from "../../application/claim-whatsapp-conversation.use-case.js";
import { SendTicketMessageUseCase } from "../../application/send-ticket-message.use-case.js";
import { CloseWhatsAppConversationUseCase } from "../../application/close-whatsapp-conversation.use-case.js";
import { publicConversationMessage } from "../../application/whatsapp-conversation-projection.js";

import { conversationContext } from "../../application/whatsapp-conversation-context.js";

const principal = (request: unknown) => currentTenantPrincipal(request as Parameters<typeof currentTenantPrincipal>[0]);
@Controller("support/whatsapp/conversations")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({ humanOnly: true, humanRoles: ["owner", "admin", "staff"] })
@RequireTenantRoles("owner", "admin", "staff")
export class WhatsAppConversationsController {
  constructor(private readonly read: ReadWhatsAppConversationsUseCase, private readonly claim: ClaimWhatsAppConversationUseCase,
    private readonly send: SendTicketMessageUseCase, private readonly close: CloseWhatsAppConversationUseCase) {}
  @Get() list(@Req() request: unknown, @Query() query: unknown) { return this.read.list(principal(request), query); }
  context(@Req() request: unknown, @Query() query: unknown) {
    if(!query||typeof query!=="object"||Array.isArray(query)||Object.keys(query).length)throw new BadRequestException("invalid_whatsapp_context_query");
    return conversationContext(principal(request));
  }
  @Get(":ticketId") detail(@Req() request: unknown, @Param("ticketId") ticketId: string, @Query() query: unknown) { return this.read.detail(principal(request), ticketId, query); }
  @Post(":ticketId/claim") claimCase(@Req() request: unknown, @Param("ticketId") ticketId: string, @Body() body: unknown) { return this.claim.execute(principal(request), ticketId, body); }
  @Post(":ticketId/close") closeCase(@Req() request: unknown, @Param("ticketId") ticketId: string, @Body() body: unknown) { return this.close.execute(principal(request), ticketId, body); }
  @Post(":ticketId/messages") async sendMessage(@Req() request: unknown, @Param("ticketId") ticketId: string, @Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["content", "clientMessageId"].includes(key))) throw new BadRequestException("invalid_whatsapp_message");
    const content: unknown = Reflect.get(body, "content"), clientMessageId: unknown = Reflect.get(body, "clientMessageId");
    if (typeof content !== "string" || typeof clientMessageId !== "string") throw new BadRequestException("invalid_whatsapp_message");
    const actor = principal(request), message = await this.send.execute({ ticketId, merchantId: actor.tenantId, senderType: "merchant", content, clientMessageId }, { principal: actor, requiredSource: "whatsapp" });
    return publicConversationMessage({ ...message, createdAt: new Date(message.createdAt) }, ticketId);
  }
}
