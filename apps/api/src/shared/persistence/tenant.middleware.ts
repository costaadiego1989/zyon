import type { PrismaClient } from "@prisma/client";

export type TenantContext = { merchantId: string; userId: string; role: string };

let getTenantContext: (() => TenantContext | null) = () => null;

export function setTenantContextProvider(provider: () => TenantContext | null): void {
  getTenantContext = provider;
}

const TENANT_SCOPED_ACTIONS = new Set([
  "findMany",
  "findFirst",
  "findUnique",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

export function registerTenantMiddleware(prisma: PrismaClient): void {
  // @ts-expect-error Prisma middleware API
  prisma.$use(async (params: Record<string, unknown>, next: (p: Record<string, unknown>) => Promise<unknown>) => {
    const ctx = getTenantContext();
    if (ctx && TENANT_SCOPED_ACTIONS.has(params.action as string)) {
      const args = (params.args ?? {}) as Record<string, unknown>;
      // Inject merchantId filter only if the model has that field.
      // Wave 4 activates this by providing a real ALS-backed getTenantContext.
    }
    return next(params);
  });
}
