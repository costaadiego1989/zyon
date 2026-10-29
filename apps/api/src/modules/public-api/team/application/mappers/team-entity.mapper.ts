import type { TeamMemberInfo, ListTeamOutput } from '../../../../team/application/use-cases/list-team.use-case.js';
import type { InviteMemberOutput } from '../../../../team/application/use-cases/invite-member.use-case.js';
import type { AcceptInviteOutput } from '../../../../team/application/use-cases/accept-invite.use-case.js';
import type { UpdateRoleOutput } from '../../../../team/application/use-cases/update-role.use-case.js';

export class TeamEntityMapper {
  static toMemberResponse(member: TeamMemberInfo) {
    return {
      member_id: member.member_id,
      user_id: member.user_id,
      email: member.email,
      role: member.role,
      joined_at: member.joined_at,
    };
  }

  static toListResponse(output: ListTeamOutput) {
    return {
      members: output.members.map((m) => TeamEntityMapper.toMemberResponse(m)),
      total: output.total,
    };
  }

  static toInviteResponse(output: InviteMemberOutput) {
    return {
      invite_id: output.invite_id,
      email: output.email,
      role: output.role,
      expires_at: output.expires_at,
    };
  }

  static toAcceptInviteResponse(output: AcceptInviteOutput) {
    return {
      member_id: output.member_id,
      merchant_id: output.merchant_id,
      role: output.role,
    };
  }

  static toUpdateRoleResponse(output: UpdateRoleOutput) {
    return {
      member_id: output.member_id,
      role: output.role,
    };
  }

  static toRemoveMemberResponse(userId: string) {
    return {
      removed: true,
      user_id: userId,
    };
  }
}
