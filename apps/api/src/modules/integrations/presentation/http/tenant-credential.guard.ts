import { ForbiddenException } from "@nestjs/common";
import { requireStaffAccess } from "../../../auth/presentation/staff-access.js";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  setTenantPrincipal,
  type TenantPrincipalRequest,
} from "../../../../shared/auth/tenant-principal.js";
import { AuthCookieService } from "../../../auth/domain/services/auth-cookie.service.js";
import { JwtService } from "../../../auth/domain/services/jwt.service.js";
import { AuthenticateMerchantApiKeyService } from "../../application/authenticate-merchant-api-key.service.js";

@Injectable()
export class TenantCredentialGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly cookies: AuthCookieService,
    private readonly authenticateApiKey: AuthenticateMerchantApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const serviceKey = readServiceKey(request.headers ?? {});
    if (serviceKey) {
      const apiKey = await this.authenticateApiKey.execute(
        serviceKey,
        request.ip,
      );
      request.apiKey = apiKey;
      setTenantPrincipal(request as TenantPrincipalRequest, {
        kind: "service",
        tenantId: apiKey.merchantId,
        credentialId: apiKey.id,
        environment: apiKey.environment,
        scopes: apiKey.scopes,
      });
      return true;
    }

    const authorization = request.headers?.authorization;
    const bearer =
      typeof authorization === "string" &&
      authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length).trim()
        : undefined;
    const token = bearer || this.cookies.read(request.headers?.cookie);
    if (!token) {
      throw new UnauthorizedException("missing_tenant_credential");
    }
    try {
      const user = await this.jwt.authenticate(token);
      requireStaffAccess(context, user.role);
      request.user = user;
      setTenantPrincipal(request as TenantPrincipalRequest, {
        kind: "human",
        tenantId: user.merchantId,
        userId: user.userId,
        email: user.email,
        role: user.role,
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException("invalid_tenant_credential");
    }
  }
}

function readServiceKey(
  headers: Record<string, unknown>,
): string | undefined {
  const explicit = headers["x-aacp-api-key"];
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  const authorization = headers.authorization;
  if (typeof authorization !== "string") return undefined;
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  return bearer.startsWith("aacp_") ? bearer : undefined;
}
