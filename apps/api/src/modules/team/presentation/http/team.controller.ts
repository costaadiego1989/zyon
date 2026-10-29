/**
 * Team management controller.
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { AuthGuard } from "../../../../modules/auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../../../modules/auth/presentation/tenant-role.guard.js";
import { RequireTenantRoles } from "../../../../modules/auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { Request } from "express";
import { Req } from "@nestjs/common";
import { InviteMemberUseCase } from "../../application/use-cases/invite-member.use-case.js";
import { AcceptInviteUseCase } from "../../application/use-cases/accept-invite.use-case.js";
import { ListTeamUseCase } from "../../application/use-cases/list-team.use-case.js";
import { UpdateRoleUseCase } from "../../application/use-cases/update-role.use-case.js";
import { RemoveMemberUseCase } from "../../application/use-cases/remove-member.use-case.js";

@Controller("merchants/:merchantId/team")
@UseGuards(AuthGuard, TenantRoleGuard)
export class TeamController {
  constructor(
    private readonly inviteMemberUseCase: InviteMemberUseCase,
    private readonly acceptInviteUseCase: AcceptInviteUseCase,
    private readonly listTeamUseCase: ListTeamUseCase,
    private readonly updateRoleUseCase: UpdateRoleUseCase,
    private readonly removeMemberUseCase: RemoveMemberUseCase,
  ) {}

  @Get()
  async list(@Param("merchantId") merchantId: string, @Req() req: Request) {
    this.requireTenant(req, merchantId);
    return this.listTeamUseCase.execute(merchantId);
  }

  @Post("invite")
  @RequireTenantRoles("owner", "admin")
  async invite(
    @Param("merchantId") merchantId: string,
    @Req() req: Request,
    @Body() body: { name?: string; email: string; phone?: string; role: "OWNER" | "ADMIN" | "STAFF" },
  ) {
    const principal = currentTenantPrincipal(req as any);
    return this.inviteMemberUseCase.execute({
      merchant_id: this.requireTenant(req, merchantId),
      name: body.name,
      email: body.email,
      phone: body.phone,
      role: body.role,
      invited_by: principal.kind === "human" ? principal.userId : "",
    });
  }

  @Post("accept")
  async acceptInvite(
    @Req() req: Request,
    @Body() body: { invite_id: string },
  ) {
    const principal = currentTenantPrincipal(req as any);
    if (principal.kind !== "human") {
      throw new Error("only_humans_can_accept");
    }
    return this.acceptInviteUseCase.execute({
      invite_id: body.invite_id,
      user_id: principal.userId,
    });
  }

  @Put(":userId/role")
  @RequireTenantRoles("owner", "admin")
  async updateRole(
    @Param("merchantId") merchantId: string,
    @Param("userId") userId: string,
    @Req() req: Request,
    @Body() body: { role: "OWNER" | "ADMIN" | "STAFF" },
  ) {
    const principal = currentTenantPrincipal(req as any);
    return this.updateRoleUseCase.execute({
      merchant_id: this.requireTenant(req, merchantId),
      user_id: userId,
      new_role: body.role,
      requester_id: principal.kind === "human" ? principal.userId : "",
      requester_role: (principal.kind === "human" ? principal.role?.toUpperCase() : "STAFF") as "OWNER" | "ADMIN" | "STAFF",
    });
  }

  @Delete(":userId")
  @RequireTenantRoles("owner", "admin")
  async remove(
    @Param("merchantId") merchantId: string,
    @Param("userId") userId: string,
    @Req() req: Request,
  ) {
    const principal = currentTenantPrincipal(req as any);
    await this.removeMemberUseCase.execute({
      merchant_id: this.requireTenant(req, merchantId),
      user_id: userId,
      requester_id: principal.kind === "human" ? principal.userId : "",
    });
    return { success: true };
  }
  private requireTenant(req: Request, merchantId: string): string {
    if (currentTenantPrincipal(req as any).tenantId !== merchantId) throw new ForbiddenException("tenant_mismatch");
    return merchantId;
  }

}
