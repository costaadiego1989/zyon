import { Controller, Get, Header } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PublicRoute } from "../../../../../shared/tenant/tenant.guard.js";
import { ListBillingPlansUseCase } from "../../application/list-billing-plans.use-case.js";

/** Public commercial terms only. Never exposes merchant or provider identifiers. */
@ApiTags("Billing")
@Controller("billing")
export class BillingCatalogController {
  constructor(private readonly plans: ListBillingPlansUseCase) {}
  @Get("catalog")
  @PublicRoute()
  @Header("Cache-Control", "no-store")
  catalog() { return this.plans.execute(); }
}
