import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards, BadRequestException } from "@nestjs/common";
import type { Response } from "express";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { ReturnCaseService } from "../../application/return-case.service.js";
import { ReturnOrderService } from "../../application/return-order.service.js";
import { ReturnAttachmentService } from "../../application/return-attachment.service.js";

@Controller("support/tickets")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({ serviceScopes: ["support:read"], humanRoles: ["owner", "admin", "staff"] })
export class SupportCaseController {
  constructor(private readonly cases: ReturnCaseService, private readonly orders: ReturnOrderService) {}
  @Get(":id")
  ticket(@Req() req: any, @Param("id") id: string) {
    return this.cases.operatorTicket(currentTenantPrincipal(req).tenantId, id);
  }
  @Post("for-return/:returnId")
  @RequireTenantAccess({ serviceScopes: ["support:write"], humanRoles: ["owner", "admin", "staff"] })
  forReturn(@Req() req: any, @Param("returnId") returnId: string) {
    return this.cases.forReturn(currentTenantPrincipal(req).tenantId, returnId);
  }
  @Get(":id/case")
  async detail(@Req() req: any, @Param("id") id: string, @Query("cursor") cursor?: string) {
    const principal = currentTenantPrincipal(req);
    return { ...await this.cases.detail(principal.tenantId, id, cursor), canRefund: principal.kind === "human" && ["owner", "admin"].includes(principal.role) };
  }
  @Post(":id/read")
  @RequireTenantAccess({ serviceScopes: ["support:write"], humanRoles: ["owner", "admin", "staff"] })
  read(@Req() req: any, @Param("id") id: string, @Body() body: { lastMessageId: string }) {
    return this.cases.markRead(currentTenantPrincipal(req).tenantId, id, "merchant", body.lastMessageId);
  }
  @Get(":id/refund-preview")
  async preview(@Req() req: any, @Param("id") id: string) {
    const principal = currentTenantPrincipal(req);
    const detail = await this.cases.detail(principal.tenantId, id);
    if (!detail.returnId) throw new BadRequestException("return_not_found");
    return this.orders.preview(principal.tenantId, detail.returnId);
  }
  @Post(":id/refund")
  @RequireTenantAccess({ humanOnly: true, humanRoles: ["owner", "admin"] })
  refund(@Req() req: any, @Param("id") id: string, @Body() body: { expectedAmountCents: number }) {
    return this.cases.approveRefund(currentTenantPrincipal(req).tenantId, id, body.expectedAmountCents);
  }
  @Post(":id/actions")
  @RequireTenantAccess({ humanOnly: true, humanRoles: ["owner", "admin", "staff"] })
  action(@Req() req: any, @Param("id") id: string, @Body() body: Parameters<ReturnCaseService["action"]>[3]) {
    const principal = currentTenantPrincipal(req);
    return this.cases.action(principal.tenantId, id, principal.kind === "human" ? principal.userId : "", body);
  }
}

@Controller("support/attachments")
export class SupportAttachmentController {
  constructor(private readonly photos: ReturnAttachmentService) {}
  @Get(":id")
  async image(@Param("id") id: string, @Query("access_token") token: string, @Res() response: Response) {
    const photo = await this.photos.read(id, token);
    response.setHeader("Content-Type", photo.contentType);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.send(photo.buffer);
  }
}
