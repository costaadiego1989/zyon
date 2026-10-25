import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NON_PRODUCTION_ROUTE, PRODUCTION_DISABLED_ROUTE } from "./non-production-route.js";

@Injectable()
export class NonProductionRouteGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const productionDisabled = this.reflector.getAllAndOverride<boolean>(
      PRODUCTION_DISABLED_ROUTE,
      [context.getHandler(), context.getClass()],
    );
    if (productionDisabled && process.env.NODE_ENV === "production") {
      throw new NotFoundException();
    }

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
