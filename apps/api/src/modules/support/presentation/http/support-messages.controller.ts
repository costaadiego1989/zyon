import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { SendTicketMessageUseCase } from "../../application/send-ticket-message.use-case.js";
import { ListTicketMessagesUseCase } from "../../application/list-ticket-messages.use-case.js";

@ApiTags("Support")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller("support/tickets")
export class SupportMessagesController {
  constructor(
    private readonly sendMessage: SendTicketMessageUseCase,
    private readonly listMessages: ListTicketMessagesUseCase,
  ) {}

  @Get(":id/messages")
  async list(
    @Req() request: unknown,
    @Param("id") ticketId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const principal = currentTenantPrincipal(
      request as Parameters<typeof currentTenantPrincipal>[0],
    );
    return this.listMessages.execute({
      ticketId,
      merchantId: principal.tenantId,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Post(":id/messages")
  async send(
    @Req() request: unknown,
    @Param("id") ticketId: string,
    @Body() body: { content: string },
  ) {
    const principal = currentTenantPrincipal(
      request as Parameters<typeof currentTenantPrincipal>[0],
    );
    return this.sendMessage.execute({
      ticketId,
      merchantId: principal.tenantId,
      senderType: "merchant",
      content: body.content,
    });
  }
}
