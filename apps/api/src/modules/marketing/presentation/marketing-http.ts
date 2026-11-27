import {
  ArgumentsHost,
  CanActivate,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  CallHandler,
} from "@nestjs/common";
import { defer, lastValueFrom } from "rxjs";
import { Reflector } from "@nestjs/core";
export const MARKETING_ACCESS_PROBE = "marketing:access-probe";
import { currentTenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import {
  MARKETING_CONTEXT,
  type MarketingContext,
} from "../domain/marketing-context.port.js";
import { MarketingError, requireMarketingPlan } from "../domain/marketing.js";
import { MarketingObservability } from "../infrastructure/marketing-observability.js";
@Injectable()
export class MarketingPlanGuard implements CanActivate {
  constructor(
    @Inject(MARKETING_CONTEXT) private readonly context: MarketingContext,
    private readonly reflector: Reflector
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.get<boolean>(
        MARKETING_ACCESS_PROBE,
        context.getHandler()
      ) === true
    )
      return true;
    const principal = currentTenantPrincipal(
      context.switchToHttp().getRequest()
    );
    requireMarketingPlan(await this.context.plan(principal.tenantId));
    return true;
  }
}
@Catch(MarketingError)
export class MarketingExceptionFilter implements ExceptionFilter {
  catch(error: MarketingError, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(error.status).json({
      code: error.code,
      message: error.code,
      correlation_id: CorrelationIdStorage.get(),
    });
  }
}
@Injectable()
export class MarketingHttpInterceptor implements NestInterceptor {
  constructor(private readonly observability: MarketingObservability) {}
  intercept(_context: ExecutionContext, next: CallHandler) {
    return defer(() =>
      this.observability.run("http", () => lastValueFrom(next.handle()))
    );
  }
}
