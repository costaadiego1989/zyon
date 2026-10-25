import type { Request } from "express";
import type { TenantPrincipalRequest } from "../auth/tenant-principal.js";

export type AacpHttpRequest = Request &
  TenantPrincipalRequest & {
    correlationId?: string;
  };
