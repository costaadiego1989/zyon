import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateMerchantPolicyDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  returns?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  shipping?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  warranty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  payment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  general?: string;
}
