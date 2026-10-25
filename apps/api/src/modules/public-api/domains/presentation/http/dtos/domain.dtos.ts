import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class RegisterDomainDto {
  @ApiProperty({ example: 'store.example.com', description: 'Custom domain to register' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i, {
    message: 'Invalid domain format',
  })
  domain_name!: string;
}

export class DomainResponse {
  @ApiProperty({ example: 'domain-123', description: 'Domain ID' })
  id!: string;

  @ApiProperty({ example: 'store.example.com', description: 'Domain name' })
  domain!: string;

  @ApiProperty({ example: false, description: 'Verification status' })
  verified!: boolean;

  @ApiProperty({ example: 'cname.zyon.app', description: 'CNAME target for verification' })
  cname_target!: string;

  @ApiPropertyOptional({ example: '2024-08-18T12:00:00.000Z', description: 'Verification timestamp' })
  verified_at?: string;

  @ApiProperty({ example: '2024-08-18T10:00:00.000Z', description: 'Creation timestamp' })
  created_at!: string;
}

export class RegisterDomainResponse {
  @ApiProperty({ example: 'domain-123', description: 'Domain ID' })
  domain_id!: string;

  @ApiProperty({ example: 'store.example.com', description: 'Domain name' })
  domain!: string;

  @ApiProperty({ example: 'cname.zyon.app', description: 'CNAME target for DNS verification' })
  cname_target!: string;

  @ApiProperty({
    example: 'Add a CNAME record pointing store.example.com to cname.zyon.app',
    description: 'Verification instructions',
  })
  instructions!: string;
}

export class VerifyDomainResponse {
  @ApiProperty({ example: 'store.example.com', description: 'Domain name' })
  domain!: string;

  @ApiProperty({ example: true, description: 'Verification result' })
  verified!: boolean;

  @ApiPropertyOptional({ example: '2024-08-18T12:00:00.000Z', description: 'Verification timestamp' })
  verified_at?: string;
}
