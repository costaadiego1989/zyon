import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CommerceProvider {
  WooCommerce = 'woocommerce',
  Magento = 'magento',
  VTEX = 'vtex',
}

export class WooCommerceCredentialsDto {
  @ApiProperty({ example: 'https://mystore.com' })
  @IsString()
  @IsNotEmpty()
  store_url!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  consumer_key!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  consumer_secret!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhook_secret?: string;
}

export class MagentoCredentialsDto {
  @ApiProperty({ example: 'https://mystore.magento.com' })
  @IsString()
  @IsNotEmpty()
  base_url!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  access_token!: string;

  @ApiProperty({ example: 'default' })
  @IsString()
  @IsNotEmpty()
  store_code!: string;
}

export class VtexCredentialsDto {
  @ApiProperty({ example: 'mystore' })
  @IsString()
  @IsNotEmpty()
  account_name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  app_key!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  app_token!: string;
}

export class ConnectCommerceDto {
  @ApiProperty({ enum: CommerceProvider })
  @IsEnum(CommerceProvider)
  platform!: CommerceProvider;

  @ApiProperty({ description: 'Platform-specific credentials' })
  @ValidateNested()
  @Type(() => Object, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'platform',
      subTypes: [
        { value: WooCommerceCredentialsDto, name: CommerceProvider.WooCommerce },
        { value: MagentoCredentialsDto, name: CommerceProvider.Magento },
        { value: VtexCredentialsDto, name: CommerceProvider.VTEX },
      ],
    },
  })
  credentials!:
    | WooCommerceCredentialsDto
    | MagentoCredentialsDto
    | VtexCredentialsDto;
}

export class UpdateCommerceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  credentials?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  sync_settings?: Record<string, any>;
}

export class CommerceConnectionResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CommerceProvider })
  platform!: CommerceProvider;

  @ApiProperty()
  store_url!: string;

  @ApiProperty({ enum: ['pending', 'healthy', 'degraded'] })
  status!: 'pending' | 'healthy' | 'degraded';

  @ApiPropertyOptional()
  last_sync_at?: string;

  @ApiPropertyOptional()
  last_tested_at?: string;

  @ApiPropertyOptional()
  last_error_code?: string;

  @ApiProperty()
  created_at!: string;

  @ApiProperty()
  updated_at!: string;

  @ApiPropertyOptional()
  sync_settings?: Record<string, any>;
}

export class CommerceConnectionListResponse {
  @ApiProperty({ type: [CommerceConnectionResponse] })
  connections!: CommerceConnectionResponse[];

  @ApiProperty()
  total!: number;
}
