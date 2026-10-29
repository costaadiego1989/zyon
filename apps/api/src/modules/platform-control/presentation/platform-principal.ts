import { UnauthorizedException } from "@nestjs/common";
import type { PlatformPrincipal } from "../domain/platform-operator.js";

const PLATFORM_PRINCIPAL = Symbol("platformPrincipal");

export type PlatformPrincipalRequest = {
  [PLATFORM_PRINCIPAL]?: PlatformPrincipal;
};

export function setPlatformPrincipal(request: PlatformPrincipalRequest, principal: PlatformPrincipal): void {
  request[PLATFORM_PRINCIPAL] = principal;
}

export function currentPlatformPrincipal(request: PlatformPrincipalRequest): PlatformPrincipal {
  const principal = request[PLATFORM_PRINCIPAL];
  if (!principal) throw new UnauthorizedException("missing_platform_operator");
  return principal;
}
