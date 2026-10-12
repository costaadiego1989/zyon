import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { WhatsAppDeliveryService } from "../../application/services/whatsapp-delivery.service.js";
@Controller("merchants/me/whatsapp/delivery-issues")
@UseGuards(AuthGuard)
export class WhatsAppDeliveryController {
  constructor(private readonly delivery: WhatsAppDeliveryService) {}
  @Get()
  list(@Req() request: Parameters<typeof currentUser>[0]) {
    return this.delivery.listIssues(currentUser(request).merchantId);
  }
}
