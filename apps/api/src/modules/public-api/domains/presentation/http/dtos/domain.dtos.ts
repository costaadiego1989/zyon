import { ApiProperty } from '@nestjs/swagger';
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
