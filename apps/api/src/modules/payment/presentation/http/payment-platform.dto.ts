import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateAsaasSubaccountDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  login_email?: string;

  @ApiProperty()
  @IsString()
  @MinLength(11)
  @MaxLength(18)
  cpf_cnpj!: string;

  @ApiPropertyOptional({ example: "1990-01-31" })
  @IsOptional()
  @IsString()
  birth_date?: string;

  @ApiPropertyOptional({
    enum: ["MEI", "LIMITED", "INDIVIDUAL", "ASSOCIATION"],
  })
  @IsOptional()
  @IsIn(["MEI", "LIMITED", "INDIVIDUAL", "ASSOCIATION"])
  company_type?: "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  mobile_phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  site?: string;

  @ApiProperty({ description: "Monthly revenue in major BRL units." })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  income_value!: number;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  address!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  address_number!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  complement?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  province!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  postal_code!: string;
}

export class CreateBillingCheckoutDto {
  @ApiProperty({ enum: ["starter", "growth", "scale"] })
  @IsIn(["starter", "growth", "scale"])
  plan!: "starter" | "growth" | "scale";
}
