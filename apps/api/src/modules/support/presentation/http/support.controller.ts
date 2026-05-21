import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { SupportSettingsPatch, SupportTicketStatusPatch } from "@aacp/shared-types";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import {
  SendSupportMessageUseCase,
  type SupportMessageInput,
} from "../../application/send-support-message.use-case.js";
import { GetSupportSettingsUseCase } from "../../application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "../../application/list-support-tickets.use-case.js";
import { UpdateSupportSettingsUseCase } from "../../application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "../../application/update-support-ticket-status.use-case.js";

@Controller("support")
export class SupportController {
  constructor(
    private readonly sendSupportMessage: SendSupportMessageUseCase,
    private readonly getSettings: GetSupportSettingsUseCase,
    private readonly updateSettings: UpdateSupportSettingsUseCase,
    private readonly listTickets: ListSupportTicketsUseCase,
    private readonly updateTicketStatus: UpdateSupportTicketStatusUseCase,
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

  @UseGuards(AuthGuard)
  @Get("settings")
  getSettings_(@Req() request: unknown) {
    return this.getSettings.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @UseGuards(AuthGuard)
  @Put("settings")
  updateSettings_(@Req() request: unknown, @Body() body: SupportSettingsPatch) {
    return this.updateSettings.execute(
      currentUser(request as { user?: unknown }).merchantId,
      body,
    );
  }

  @UseGuards(AuthGuard)
  @Get("tickets")
  getTickets(@Req() request: unknown, @Query("status") status?: string) {
    return this.listTickets.execute(currentUser(request as { user?: unknown }).merchantId, status);
  }

  @UseGuards(AuthGuard)
  @Patch("tickets/:ticketId")
  updateTicket(
    @Req() request: unknown,
    @Param("ticketId") ticketId: string,
    @Body() body: SupportTicketStatusPatch,
  ) {
    return this.updateTicketStatus.execute(
      currentUser(request as { user?: unknown }).merchantId,
      ticketId,
      body.status,
    );
  }
}
