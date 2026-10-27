import { Inject, Injectable } from "@nestjs/common";
import { PasswordHasher } from "../../auth/domain/services/password-hasher.service.js";
import { normalizePlatformEmail, type PlatformPrincipal } from "../domain/platform-operator.js";
import {
  PLATFORM_OPERATOR_REPOSITORY,
  type PlatformOperatorRepository,
} from "../domain/ports/platform-operator-repository.port.js";
import { PlatformJwtService } from "../domain/services/platform-jwt.service.js";
import { toPlatformAuthResponse, type PlatformAuthResponse } from "./platform-auth-response.js";

@Injectable()
export class LoginPlatformOperatorUseCase {
  constructor(
    @Inject(PLATFORM_OPERATOR_REPOSITORY) private readonly operators: PlatformOperatorRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwt: PlatformJwtService,
  ) {}

  async execute(input: { email: string; password: string }): Promise<PlatformAuthResponse> {
    const operator = await this.operators.findByEmail(normalizePlatformEmail(input.email));
    if (!operator || operator.disabledAt || !operator.passwordHash) throw new Error("platform_invalid_credentials");
    const password = await this.passwordHasher.verify(input.password, operator.passwordHash);
    if (!password.valid) throw new Error("platform_invalid_credentials");
    const principal: PlatformPrincipal = {
      operatorId: operator.id,
      email: operator.email,
      role: operator.role,
    };
    return toPlatformAuthResponse(principal, operator.authVersion, this.jwt);
  }
}
