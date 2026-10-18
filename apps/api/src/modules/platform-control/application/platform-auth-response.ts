import type { PlatformPrincipal } from "../domain/platform-operator.js";
import type { PlatformJwtService } from "../domain/services/platform-jwt.service.js";

export type PlatformAuthResponse = {
  operator_id: string;
  email: string;
  role: string;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
};

export async function toPlatformAuthResponse(
  principal: PlatformPrincipal,
  authVersion: number,
  jwt: PlatformJwtService,
): Promise<PlatformAuthResponse> {
  return {
    operator_id: principal.operatorId,
    email: principal.email,
    role: principal.role,
    access_token: await jwt.issue(principal, authVersion),
    token_type: "Bearer",
    expires_in: jwt.expiresIn(),
  };
}
