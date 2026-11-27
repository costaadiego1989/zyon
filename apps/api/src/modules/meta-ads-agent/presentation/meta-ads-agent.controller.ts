import { Body, Catch, Controller, ForbiddenException, Get, HttpCode, Inject, Param, Post, Put, Query, Req, UseFilters, UseGuards, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { MetaAdsCampaignDraft } from "@zyon/shared-types";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../shared/auth/tenant-principal.js";
import { MetaAdsError } from "../domain/types.js";
import { MetaAdsAgentService, publicProposal } from "../application/meta-ads-agent.service.js";
import type { ProposalInput } from "../application/proposal.service.js";

type Request = TenantPrincipalRequest & { headers?: { authorization?: string; origin?: string }; method?: string };
@Catch(MetaAdsError)
export class MetaAdsHttpErrorFilter implements ExceptionFilter {
  catch(error: MetaAdsError, host: ArgumentsHost): void { host.switchToHttp().getResponse().status(error.status).json({ code: error.code, message: error.code }); }
}
function fields<T>(body: unknown, allowed: string[]): T {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new MetaAdsError("request_fields_invalid");
  return body as T;
}
const draftFields = ["name", "destination", "priority", "variantIds", "budget", "mediaIds", "headline", "primaryText", "country"];
@Controller("meta-ads-agent")
@UseGuards(AuthGuard)
@UseFilters(MetaAdsHttpErrorFilter)
export class MetaAdsAgentController {
  constructor(@Inject(MetaAdsAgentService) private readonly service: MetaAdsAgentService) {}
  private principal(request: Request, mutation = false) {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== "human" || !["owner", "admin"].includes(principal.role)) throw new ForbiddenException("meta_ads_role_forbidden");
    if (mutation && !request.headers?.authorization?.startsWith("Bearer ")) {
      let origin: string | null = null; try { origin = new URL(this.service.env.META_ADS_DASHBOARD_URL ?? "").origin; } catch { /* Missing trusted origin fails closed for cookie mutations. */ }
      if (!origin || request.headers?.origin !== origin) throw new ForbiddenException("meta_ads_origin_forbidden");
    }
    return principal;
  }
  @Get() overview(@Req() request: Request) { return this.service.overview(this.principal(request).tenantId); }
  @Post("checkout") checkout(@Req() request: Request, @Body() body: unknown) { const p = this.principal(request, true); return this.service.billing.checkout(p.tenantId, fields(body, ["kind", "idempotencyKey", "offerVersion"])); }
  @Post("cancel") cancel(@Req() request: Request, @Body() body: unknown) { fields(body ?? {}, []); return this.service.billing.cancel(this.principal(request, true).tenantId); }
  @Post("connection/start") begin(@Req() request: Request, @Body() body: unknown) { fields(body ?? {}, []); const p = this.principal(request, true); return this.service.connection.begin(p.tenantId, p.userId); }
  @Post("connection/complete") complete(@Req() request: Request, @Body() body: unknown) { const p = this.principal(request, true); const input = fields<{ state: string; code: string }>(body, ["state", "code"]); return this.service.connection.complete(p.tenantId, p.userId, input.state, input.code); }
  @Post("connection/select") select(@Req() request: Request, @Body() body: unknown) { return this.service.connection.select(this.principal(request, true).tenantId, fields(body, ["accountId", "pageId", "catalogId", "datasetId", "whatsappId"])); }
  @Post("connection/disconnect") disconnect(@Req() request: Request, @Body() body: unknown) { fields(body ?? {}, []); return this.service.connection.disconnect(this.principal(request, true).tenantId); }
  @Get("products") async products(@Req() request: Request, @Query("query") query?: string) { const p = this.principal(request); await this.service.billing.requireAccess(p.tenantId); return this.service.commerce.products(p.tenantId, { query, limit: 30 }); }
  @Get("existing") existing(@Req() request: Request) { return this.service.campaigns.existing(this.principal(request).tenantId); }
  @Get("existing/:id/metrics") existingMetrics(@Req() request: Request, @Param("id") id: string, @Query("since") since: string, @Query("until") until: string) { return this.service.analyzeExisting(this.principal(request).tenantId, id, since, until); }
  @Post("campaigns") async create(@Req() request: Request, @Body() body: unknown) { const p = this.principal(request, true); await this.service.billing.requireAccess(p.tenantId); const input = fields<{ draft: MetaAdsCampaignDraft; idempotencyKey: string }>(body, ["draft", "idempotencyKey"]); fields(input.draft, draftFields); return this.service.campaigns.create(p.tenantId, input.draft, input.idempotencyKey); }
  @Put("campaigns/:id") save(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) { return this.service.campaigns.save(this.principal(request, true).tenantId, id, fields(body, draftFields)); }
  @Get("campaigns/:id/readiness") readiness(@Req() request: Request, @Param("id") id: string) { return this.service.campaigns.readiness(this.principal(request).tenantId, id); }
  @Post("campaigns/:id/stop") stop(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) { fields(body ?? {}, []); return this.service.campaigns.stopManaging(this.principal(request, true).tenantId, id); }
  @Post("campaigns/:id/generations") @HttpCode(202) generate(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) { return this.service.generations.request(this.principal(request, true).tenantId, id, fields(body, ["imageCount", "idempotencyKey"])); }
  @Post("campaigns/:id/proposals") async propose(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) { return publicProposal(await this.service.proposals.create(this.principal(request, true).tenantId, id, fields<ProposalInput>(body, ["kind", "after", "reasoning", "idempotencyKey"]))); }
  @Post("proposals/:id/approve") async approve(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) { const p = this.principal(request, true); const input = fields<{ digest: string }>(body, ["digest"]); return publicProposal(await this.service.proposals.approve(p.tenantId, id, p.userId, input.digest)); }
  @Post("proposals/:id/reject") async reject(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) { fields(body ?? {}, []); const p = this.principal(request, true); return publicProposal(await this.service.proposals.reject(p.tenantId, id, p.userId)); }
  @Post("proposals/:id/execute") execute(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) { fields(body ?? {}, []); const p = this.principal(request, true); return this.service.executions.execute(p.tenantId, id, p.userId); }
  @Post("executions/:id/reconcile") reconcile(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) { fields(body ?? {}, []); return this.service.executions.reconcile(this.principal(request, true).tenantId, id); }
}
