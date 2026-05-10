import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { TenantContextService } from "./tenant-context.service.js";

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenantCtx: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      user?: { merchantId: string; userId: string; role: string };
    }>();
    const user = request.user;
    if (!user?.merchantId) return next.handle();

    return new Observable((subscriber) => {
      this.tenantCtx.run(
        { merchantId: user.merchantId, userId: user.userId, role: user.role },
        () => {
          next.handle().subscribe(subscriber);
        }
      );
    });
  }
}
