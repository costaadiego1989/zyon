import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
export class OrderFulfillmentActionDto {
  @IsString() @MinLength(3) @MaxLength(50) action!: string;
  @IsInt() @Min(0) expected_version!: number;
  @IsString() @MinLength(8) @MaxLength(191) command_id!: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) proof?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
  @IsOptional() @IsString() @MaxLength(191) schedule_slot_id?: string;
}
