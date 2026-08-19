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
