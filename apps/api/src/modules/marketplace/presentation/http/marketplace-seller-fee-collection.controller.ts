import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import type { MarketplaceContributionActor } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";
import type { MarketplaceSellerFeeCollectionJournal } from "../../domain/ports/marketplace-seller-fee-collection.port.js";
import { MarketplaceSellerFeeCollectionService } from "../../application/marketplace-seller-fee-collection.service.js";

export function sellerFeeCollectionView(j:MarketplaceSellerFeeCollectionJournal) {
  return {collection_id:j.id,debt_id:j.request.debtId,fee_certificate_id:j.request.feeCertificateId,environment:j.request.environment,status:j.status,
    gross_amount_cents:j.request.grossAmountCents,maximum_credit_cents:j.request.maximumCreditCents,credited_net_cents:j.credit?.creditCents??0,
    processing_fee_cents:j.credit?.processingFeeCents??0,processing_fee_known:!!j.credit,excess_liability_cents:j.credit?.excessLiabilityCents??0,
    ...(j.credit?.excessLiabilityCents?{excess_status:j.excessStatus??"held",returned_excess_cents:j.returnedExcessCents??0,
      outstanding_excess_cents:j.outstandingExcessCents??j.credit.excessLiabilityCents,can_return_excess:j.canReturnExcess===true}:{}),
    ...(j.checkoutUrl?{checkout_url:j.checkoutUrl}:{}),request_hash:j.request.requestHash,
    can_execute:false,can_cancel:j.status==="approved",currency:"BRL",funding_hold_released:false,payout_reauthorized:false};
}
@UseGuards(AuthGuard)
@RequireTenantRoles("owner","admin")
@Controller("marketplace/dashboard/seller-fee-collections")
export class MarketplaceSellerFeeCollectionController {
  constructor(@Inject(MarketplaceSellerFeeCollectionService) private readonly service:MarketplaceSellerFeeCollectionService) {}
  @Get("candidates")
  @Header("Cache-Control","no-store")
  async candidates(@Req() req:TenantPrincipalRequest,@Query("limit") limit?:string,@Query("cursor") cursor?:string){
    const actor=this.actor(req),n=limit===undefined?20:Number(limit);
    if(!Number.isSafeInteger(n)||n<1||n>100||cursor!==undefined&&(typeof cursor!=="string"||cursor.length>1024))this.invalid();
    const page=await this.service.candidates(actor,n,cursor);return {items:page.items.map(item=>({...item,can_prepare:false})),...(page.nextCursor?{next_cursor:page.nextCursor}:{})};
  }
  @Get("hosted-context/:debtId")
  @Header("Cache-Control","no-store")
  async hostedContext(@Req() req:TenantPrincipalRequest,@Param("debtId") debtId:string){
    const actor=this.actor(req);this.id(debtId);return {...await this.service.hostedContext(actor,debtId),can_prepare:false};
  }
  @Post("hosted")
  @Header("Cache-Control","no-store")
  async hosted(@Req() req:TenantPrincipalRequest,@Body() body:unknown){
    const actor=this.actor(req),v=this.body(body,["debt_id","collection_id","gross_amount_cents","confirmed"]);
    this.id(v.debt_id);this.id(v.collection_id);this.amount(v.gross_amount_cents);
    this.newCollectionUnavailable();
    return sellerFeeCollectionView(await this.service.hosted(actor,{debtId:String(v.debt_id),collectionId:String(v.collection_id),
      grossAmountCents:Number(v.gross_amount_cents),confirmed:true}));
  }
  @Get("context/:debtId")
  @Header("Cache-Control","no-store")
  async context(@Req() req:TenantPrincipalRequest,@Param("debtId") debtId:string){const actor=this.actor(req);this.id(debtId);return {...await this.service.context(actor,debtId),canPrepare:false};}
  @Post("obligations/:debtId/close")
  @Header("Cache-Control","no-store")
  async closeObligation(@Req() req:TenantPrincipalRequest,@Param("debtId") debtId:string,@Body() body:unknown){
    const actor=this.actor(req);this.id(debtId);this.body(body,["confirmed"]);return this.service.closeObligation(actor,debtId);
  }
  @Get()
  @Header("Cache-Control","no-store")
  async list(@Req() req:TenantPrincipalRequest,@Query("debt_id") debtId:string,@Query("limit") limit?:string,@Query("cursor") cursor?:string){
    const actor=this.actor(req);this.id(debtId);const n=limit===undefined?20:Number(limit);
    if(!Number.isSafeInteger(n)||n<1||n>100||cursor!==undefined&&(typeof cursor!=="string"||cursor.length>1024))this.invalid();
    const page=await this.service.list(actor,debtId,n,cursor);return {items:page.items.map(sellerFeeCollectionView),...(page.nextCursor?{next_cursor:page.nextCursor}:{})};
  }
  @Get(":collectionId")
  @Header("Cache-Control","no-store")
  async get(@Req() req:TenantPrincipalRequest,@Param("collectionId") id:string){const actor=this.actor(req);this.id(id);return sellerFeeCollectionView(await this.service.get(actor,id));}
  @Post()
  @Header("Cache-Control","no-store")
  async prepare(@Req() req:TenantPrincipalRequest,@Body() body:unknown){const actor=this.actor(req),v=this.body(body,["debt_id","collection_id","customer_id","gross_amount_cents","confirmed"]);
    this.id(v.debt_id);this.id(v.collection_id);this.amount(v.gross_amount_cents);if(typeof v.customer_id!=="string"||!/^cus_[A-Za-z0-9_]+$/.test(v.customer_id))this.invalid();
    this.newCollectionUnavailable();
    return sellerFeeCollectionView(await this.service.prepare(actor,{debtId:String(v.debt_id),collectionId:String(v.collection_id),customerId:v.customer_id,grossAmountCents:Number(v.gross_amount_cents),confirmed:true}));}
  @Post(":collectionId/execute")
  @Header("Cache-Control","no-store")
  async execute(@Req() req:TenantPrincipalRequest,@Param("collectionId") id:string,@Body() body:unknown){const actor=this.actor(req);this.id(id);const v=this.body(body,["gross_amount_cents","confirmed"]);this.amount(v.gross_amount_cents);
    this.newCollectionUnavailable();
    return sellerFeeCollectionView(await this.service.execute(actor,id,Number(v.gross_amount_cents)));}
  @Post(":collectionId/reconcile")
  @Header("Cache-Control","no-store")
  async reconcile(@Req() req:TenantPrincipalRequest,@Param("collectionId") id:string,@Body() body:unknown){const actor=this.actor(req);this.id(id);this.body(body,["confirmed"]);return sellerFeeCollectionView(await this.service.reconcile(actor,id));}
  @Post(":collectionId/cancel")
  @Header("Cache-Control","no-store")
  async cancel(@Req() req:TenantPrincipalRequest,@Param("collectionId") id:string,@Body() body:unknown){const actor=this.actor(req);this.id(id);this.body(body,["confirmed"]);return sellerFeeCollectionView(await this.service.cancel(actor,id));}
  @Post(":collectionId/excess/return")
  @Header("Cache-Control","no-store")
  async returnExcess(@Req() req:TenantPrincipalRequest,@Param("collectionId") id:string,@Body() body:unknown){
    const actor=this.actor(req);this.id(id);const v=this.body(body,["amount_cents","confirmed"]);
    if(!Number.isSafeInteger(v.amount_cents)||Number(v.amount_cents)<1||Number(v.amount_cents)>2147483647)this.invalid();
    return sellerFeeCollectionView(await this.service.returnExcess(actor,id,Number(v.amount_cents)));
  }
  // MVP excludes new complementary charges; existing journals retain recovery routes.
  private newCollectionUnavailable():void{throw new ConflictException({code:"marketplace_dispute_fee_collection_outside_mvp",message:"Cobranças complementares de taxas de disputa não fazem parte do MVP."});}
  private actor(req:TenantPrincipalRequest):MarketplaceContributionActor{const p=currentTenantPrincipal(req);if(p.kind!=="human"||!["owner","admin"].includes(p.role))throw new ForbiddenException("marketplace_seller_fee_human_approval_required");return {merchantId:p.tenantId,userId:p.userId};}
  private body(body:unknown,keys:string[]){if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==keys.length||Object.keys(body).some(k=>!keys.includes(k)))this.invalid();
    const v=body as Record<string,unknown>;if(v.confirmed!==true)this.invalid();return v;}
  private id(v:unknown){if(typeof v!=="string"||!/^[A-Za-z0-9_-]{1,200}$/.test(v))this.invalid();}
  private amount(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<50||Number(v)>2147483647)this.invalid();}
  private invalid():never{throw new BadRequestException("invalid_marketplace_seller_fee_confirmation");}
}
