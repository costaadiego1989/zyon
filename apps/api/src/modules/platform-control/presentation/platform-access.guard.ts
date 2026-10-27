import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PlatformJwtService } from "../domain/services/platform-jwt.service.js";
import { setPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

@Injectable()
export class PlatformAccessGuard implements CanActivate {
  private readonly logger = new Logger(PlatformAccessGuard.name);

  constructor(private readonly jwt: PlatformJwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformPrincipalRequest & { headers?: { authorization?: string | string[] } }>();
    const authorization = request.headers?.authorization;
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("missing_platform_bearer_token");
    try {
      const principal = await this.jwt.authenticate(header.slice("Bearer ".length));
      setPlatformPrincipal(request, principal);
      return true;
    } catch (error) {
      this.logger.debug(`Platform JWT verification failed: ${platformErrorCode(error)}`);
      throw new UnauthorizedException("invalid_platform_bearer_token");
    }
  }
}

function platformErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "platform_auth_failed";
  return error.message.startsWith("platform_") ? error.message : "platform_auth_failed";
}
