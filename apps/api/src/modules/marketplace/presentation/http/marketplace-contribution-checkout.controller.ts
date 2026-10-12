import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import type { MarketplaceContributionActor } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";
import type { MarketplaceContributionCheckoutJournal } from "../../domain/ports/marketplace-contribution-checkout.port.js";
import { MarketplaceContributionCheckoutService } from "../../application/marketplace-contribution-checkout.service.js";

export function contributionCheckoutView(j:MarketplaceContributionCheckoutJournal) {
  return {kind:"journal" as const,contribution_id:j.id,refund_plan_id:j.request.refundPlanId,environment:j.request.environment,status:j.status,
    gross_amount_cents:j.request.grossAmountCents,maximum_credit_cents:j.request.maximumCreditCents,
    credited_net_cents:j.creditedNetCents??0,processing_fee_cents:j.processingFeeCents??0,excess_liability_cents:j.excessLiabilityCents??0,
    returned_excess_cents:j.returnedExcessCents??0,...(j.excessStatus?{excess_status:j.excessStatus}:{}),
    ...(j.checkoutUrl?{checkout_url:j.checkoutUrl}:{}),request_hash:j.request.requestHash,can_create:false,can_return_excess:j.canReturnExcess===true,
    currency:"BRL",collection_mode:"hosted_checkout",processing_fee_known:j.creditCertified===true || j.status==="credited",can_cancel:j.status==="approved"};
}
@UseGuards(AuthGuard)
@RequireTenantRoles("owner","admin")
@Controller("marketplace/dashboard/contribution-checkouts")
export class MarketplaceContributionCheckoutController {
  constructor(@Inject(MarketplaceContributionCheckoutService) private readonly service:MarketplaceContributionCheckoutService) {}
  @Get()
  @Header("Cache-Control","no-store")
  async list(@Req() req:TenantPrincipalRequest,@Query("limit") limit?:string,@Query("cursor") cursor?:string){
    const actor=this.actor(req),n=limit===undefined?20:Number(limit);
    if(!Number.isSafeInteger(n)||n<1||n>100||cursor!==undefined&&(typeof cursor!=="string"||cursor.length>1024))this.invalid();
    const result=await this.service.list(actor,n,cursor);
    return {items:result.items.map(v=>"request" in v?contributionCheckoutView(v):{kind:"candidate",...v}),...(result.nextCursor?{next_cursor:result.nextCursor}:{})};
  }
  @Get("context/:refundPlanId")
  @Header("Cache-Control","no-store")
  async context(@Req() req:TenantPrincipalRequest,@Param("refundPlanId") id:string){const actor=this.actor(req);this.id(id);return {kind:"candidate",...await this.service.context(actor,id)};}
  @Get(":contributionId")
  @Header("Cache-Control","no-store")
  async get(@Req() req:TenantPrincipalRequest,@Param("contributionId") id:string){const actor=this.actor(req);this.id(id);return contributionCheckoutView(await this.service.get(actor,id));}
  @Post()
  @Header("Cache-Control","no-store")
  async prepare(@Req() req:TenantPrincipalRequest,@Body() body:unknown){
    const actor=this.actor(req),v=this.body(body,["refund_plan_id","contribution_id","gross_amount_cents","confirmed"]);
    this.id(v.refund_plan_id);this.id(v.contribution_id);this.amount(v.gross_amount_cents);
    return contributionCheckoutView(await this.service.prepare(actor,{refundPlanId:String(v.refund_plan_id),contributionId:String(v.contribution_id),grossAmountCents:Number(v.gross_amount_cents),confirmed:true}));
  }
  @Post(":contributionId/execute")
  @Header("Cache-Control","no-store")
  async execute(@Req() req:TenantPrincipalRequest,@Param("contributionId") id:string,@Body() body:unknown){
    const actor=this.actor(req);this.id(id);const v=this.body(body,["gross_amount_cents","confirmed"]);this.amount(v.gross_amount_cents);
    return contributionCheckoutView(await this.service.execute(actor,id,Number(v.gross_amount_cents)));
  }
  @Post(":contributionId/reconcile")
  @Header("Cache-Control","no-store")
  async reconcile(@Req() req:TenantPrincipalRequest,@Param("contributionId") id:string,@Body() body:unknown){const actor=this.actor(req);this.id(id);this.body(body,["confirmed"]);return contributionCheckoutView(await this.service.reconcile(actor,id));}
  @Post(":contributionId/cancel")
  @Header("Cache-Control","no-store")
  async cancel(@Req() req:TenantPrincipalRequest,@Param("contributionId") id:string,@Body() body:unknown){const actor=this.actor(req);this.id(id);this.body(body,["confirmed"]);return contributionCheckoutView(await this.service.cancel(actor,id));}
  @Post(":contributionId/return-excess")
  @Header("Cache-Control","no-store")
  async returnExcess(@Req() req:TenantPrincipalRequest,@Param("contributionId") id:string,@Body() body:unknown){const actor=this.actor(req);this.id(id);const v=this.body(body,["amount_cents","confirmed"]);this.amount(v.amount_cents);return contributionCheckoutView(await this.service.returnExcess(actor,id,Number(v.amount_cents)));}
  private actor(req:TenantPrincipalRequest):MarketplaceContributionActor{const p=currentTenantPrincipal(req);if(p.kind!=="human"||!["owner","admin"].includes(p.role))throw new ForbiddenException("marketplace_contribution_human_approval_required");return {merchantId:p.tenantId,userId:p.userId};}
  private body(value:unknown,keys:string[]){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))this.invalid();const v=value as Record<string,unknown>;if(v.confirmed!==true)this.invalid();return v;}
  private id(v:unknown){if(typeof v!=="string"||!/^[A-Za-z0-9_-]{1,200}$/.test(v))this.invalid();}
  private amount(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>2147483647)this.invalid();}
  private invalid():never{throw new BadRequestException("invalid_marketplace_contribution_checkout_confirmation");}
}
