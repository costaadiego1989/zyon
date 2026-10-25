import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
  merchantId: string;
  userId: string;
  role: string;
  correlationId?: string;
  buyerGlobalUserId?: string;
  embedSessionToken?: string;
}

@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantContext>();

  run<T>(ctx: TenantContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  get(): TenantContext | null {
    return this.als.getStore() ?? null;
  }
}
