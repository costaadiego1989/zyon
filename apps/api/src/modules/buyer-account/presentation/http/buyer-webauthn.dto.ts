import { Type } from "class-transformer";
import { Equals, IsDefined, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from "class-validator";

class CredentialIdentityDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(2048)
  id!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(2048)
  rawId!: string;
  @Equals("public-key")
  type!: "public-key";
}
class ClientDataDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(16384)
  clientDataJSON!: string;
}
class AttestationDto extends ClientDataDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(65536)
  attestationObject!: string;
}
class AssertionDto extends ClientDataDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(16384)
  authenticatorData!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MaxLength(2048)
  signature!: string;
}
class RegistrationCredentialDto extends CredentialIdentityDto {
  @IsDefined() @ValidateNested() @Type(() => AttestationDto)
  response!: AttestationDto;
}
class LoginCredentialDto extends CredentialIdentityDto {
  @IsDefined() @ValidateNested() @Type(() => AssertionDto)
  response!: AssertionDto;
}
class ChallengeDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]+$/) @MinLength(43) @MaxLength(43)
  challenge!: string;
}
export class WebAuthnRegistrationDto extends ChallengeDto {
  @IsDefined() @ValidateNested() @Type(() => RegistrationCredentialDto)
  credential!: RegistrationCredentialDto;
}
export class WebAuthnLoginDto extends ChallengeDto {
  @IsDefined() @ValidateNested() @Type(() => LoginCredentialDto)
  credential!: LoginCredentialDto;
}
export class WebAuthnLoginOptionsDto {
  @IsOptional() @IsEmail() @MaxLength(254)
  email?: string;
}
