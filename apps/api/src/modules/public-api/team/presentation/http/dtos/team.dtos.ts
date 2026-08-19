import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEmail, IsEnum } from 'class-validator';

export enum TeamRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
}

export class InviteMemberDto {
  @ApiProperty({ example: 'jane@example.com', description: 'Email of the member to invite' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ enum: TeamRole, example: 'ADMIN', description: 'Role to assign' })
  @IsEnum(TeamRole)
  role!: TeamRole;
}

export class UpdateRoleDto {
  @ApiProperty({ enum: TeamRole, example: 'STAFF', description: 'New role for the member' })
  @IsEnum(TeamRole)
  role!: TeamRole;
}

export class TeamMemberResponse {
  @ApiProperty({ example: 'member-123', description: 'Member ID' })
  member_id!: string;

  @ApiProperty({ example: 'user-456', description: 'User ID' })
  user_id!: string;

  @ApiProperty({ example: 'jane@example.com', description: 'Member email' })
  email!: string;

  @ApiProperty({ enum: TeamRole, example: 'ADMIN', description: 'Member role' })
  role!: TeamRole;

  @ApiProperty({ example: '2024-08-18T10:00:00.000Z', description: 'Join timestamp' })
  joined_at!: string;
}

export class ListTeamResponse {
  @ApiProperty({ type: [TeamMemberResponse], description: 'Team members list' })
  members!: TeamMemberResponse[];

  @ApiProperty({ example: 5, description: 'Total member count' })
  total!: number;
}

export class InvitationResponse {
  @ApiProperty({ example: 'invite-789', description: 'Invitation ID' })
  invite_id!: string;

  @ApiProperty({ example: 'jane@example.com', description: 'Invited email' })
  email!: string;

  @ApiProperty({ enum: TeamRole, example: 'ADMIN', description: 'Role being offered' })
  role!: TeamRole;

  @ApiProperty({ example: '2024-09-18T10:00:00.000Z', description: 'Invitation expiry timestamp' })
  expires_at!: string;
}

export class AcceptInviteResponse {
  @ApiProperty({ example: 'member-999', description: 'New member ID' })
  member_id!: string;

  @ApiProperty({ example: 'merchant-123', description: 'Merchant ID' })
  merchant_id!: string;

  @ApiProperty({ enum: TeamRole, example: 'ADMIN', description: 'Assigned role' })
  role!: TeamRole;
}

export class UpdateRoleResponse {
  @ApiProperty({ example: 'member-123', description: 'Member ID' })
  member_id!: string;

  @ApiProperty({ enum: TeamRole, example: 'STAFF', description: 'New role' })
  role!: TeamRole;
}

export class RemoveMemberResponse {
  @ApiProperty({ example: true, description: 'Removal success status' })
  removed!: boolean;

  @ApiProperty({ example: 'user-456', description: 'Removed user ID' })
  user_id!: string;
}
