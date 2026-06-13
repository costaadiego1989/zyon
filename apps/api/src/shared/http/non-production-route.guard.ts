import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NON_PRODUCTION_ROUTE } from "./non-production-route.js";

@Injectable()
export class NonProductionRouteGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const nonProductionOnly = this.reflector.getAllAndOverride<boolean>(
      NON_PRODUCTION_ROUTE,
      [context.getHandler(), context.getClass()],
    );

    if (nonProductionOnly && process.env.NODE_ENV === "production" && !legacyRoutesEnabled()) {
      throw new NotFoundException();
    }

    return true;
  }
}

function legacyRoutesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.ENABLE_LEGACY_ROUTES?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}
