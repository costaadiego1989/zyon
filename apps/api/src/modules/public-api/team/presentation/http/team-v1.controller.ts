import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBody,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { InviteMemberUseCase } from '../../../../team/application/use-cases/invite-member.use-case.js';
import { AcceptInviteUseCase } from '../../../../team/application/use-cases/accept-invite.use-case.js';
import { ListTeamUseCase } from '../../../../team/application/use-cases/list-team.use-case.js';
import { UpdateRoleUseCase } from '../../../../team/application/use-cases/update-role.use-case.js';
import { RemoveMemberUseCase } from '../../../../team/application/use-cases/remove-member.use-case.js';
import { TeamEntityMapper } from '../../application/mappers/team-entity.mapper.js';
import {
  InviteMemberDto,
  UpdateRoleDto,
  ListTeamResponse,
  InvitationResponse,
  AcceptInviteResponse,
  UpdateRoleResponse,
  RemoveMemberResponse,
} from './dtos/team.dtos.js';

@ApiTags('Team')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('team')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class TeamV1Controller {
  constructor(
    private readonly listTeamUseCase: ListTeamUseCase,
    private readonly inviteMemberUseCase: InviteMemberUseCase,
    private readonly acceptInviteUseCase: AcceptInviteUseCase,
    private readonly updateRoleUseCase: UpdateRoleUseCase,
    private readonly removeMemberUseCase: RemoveMemberUseCase,
  ) {}

  @Get('members')
  @RequireTenantAccess({ serviceScopes: ['team:read'] })
  @ApiOperation({ summary: 'List team members' })
  @ApiOkResponse({ description: 'Team members list', type: ListTeamResponse })
  async listMembers(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.listTeamUseCase.execute(merchantId);
    return TeamEntityMapper.toListResponse(result);
  }

  @Post('invitations')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['team:write'] })
  @ApiOperation({ summary: 'Invite a team member' })
  @ApiBody({ type: InviteMemberDto })
  @ApiCreatedResponse({ description: 'Invitation created', type: InvitationResponse })
  async inviteMember(@Req() req: any, @Body() body: InviteMemberDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const requesterId = req.tenantPrincipal?.userId ?? req.user?.id;
    const result = await this.inviteMemberUseCase.execute({
      merchant_id: merchantId,
      email: body.email,
      role: body.role,
      invited_by: requesterId,
    });
    return TeamEntityMapper.toInviteResponse(result);
  }

  @Post('invitations/:inviteId/accept')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['team:write'] })
  @ApiOperation({ summary: 'Accept an invitation' })
  @ApiOkResponse({ description: 'Invitation accepted', type: AcceptInviteResponse })
  async acceptInvite(@Req() req: any, @Param('inviteId') inviteId: string) {
    const userId = req.tenantPrincipal?.userId ?? req.user?.id;
    const result = await this.acceptInviteUseCase.execute({
      invite_id: inviteId,
      user_id: userId,
    });
    return TeamEntityMapper.toAcceptInviteResponse(result);
  }

  @Patch('members/:userId/role')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['team:write'] })
  @ApiOperation({ summary: 'Update a member role' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiOkResponse({ description: 'Role updated', type: UpdateRoleResponse })
  async updateRole(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: UpdateRoleDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const requesterRole = req.tenantPrincipal?.role ?? 'STAFF';
    const result = await this.updateRoleUseCase.execute({
      merchant_id: merchantId,
      user_id: userId,
      new_role: body.role,
      requester_role: requesterRole,
    });
    return TeamEntityMapper.toUpdateRoleResponse(result);
  }

  @Delete('members/:userId')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['team:write'] })
  @ApiOperation({ summary: 'Remove a team member' })
  @ApiOkResponse({ description: 'Member removed', type: RemoveMemberResponse })
  async removeMember(@Req() req: any, @Param('userId') userId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.removeMemberUseCase.execute({
      merchant_id: merchantId,
      user_id: userId,
    });
    return TeamEntityMapper.toRemoveMemberResponse(userId);
  }
}
