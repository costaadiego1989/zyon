import { Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { AsaasMarketplaceResidualAuthorizationReader, AsaasMarketplaceResidualRequest,
  AsaasMarketplaceResidualAccountReader,AsaasMarketplaceResidualAccount } from "../../domain/ports/asaas-marketplace-residual.port.js";
import { fundingHash, lockMarketplaceOrder } from "./prisma-marketplace-funding.repository.js";
import { readMarketplaceAsaasResidualBasis, buildMarketplaceAsaasResidualOperationRequest } from "./asaas-marketplace-residual-basis.js";
import { decryptPaymentSecret } from "../../../payment/infrastructure/payment-secret-cipher.js";
import { marketplaceCaptureAccount } from "../marketplace-capture-account.js";
import type {AsaasMarketplaceHostRetentionOutboundRequest,AsaasMarketplaceHostRetentionRequest,AsaasMarketplaceHostRetentionProof} from '../../domain/ports/asaas-marketplace-host-retention.port.js';
import {validAsaasMarketplaceHostRetentionProof} from '../../domain/services/asaas-marketplace-host-retention.js';
import {readMarketplaceAsaasHostRetentionBasis,buildMarketplaceAsaasHostRetentionOperationRequest} from './asaas-marketplace-residual-basis.js';

export const asaasResidualSubmissionEventId = (operationId: string): string => `marketplace_asaas_residual_submission_${operationId}`;
type Row = Prisma.MarketplaceResidualOperationGetPayload<{include:{residualPlan:true}}>;
function fail(code:string):never {throw Error(code);}

/** The ordinary journal claims work; this independently consumes the actual
 * financial submission. A crash between commit and HTTP permanently leaves
 * the operation GET-only. No event ever means "safe to retry a POST". */
@Injectable()
export class PrismaAsaasMarketplaceResidualAuthorizationRepository implements AsaasMarketplaceResidualAuthorizationReader {
  constructor(@Inject(PrismaClient) private readonly prisma:PrismaClient,
    @Optional() @Inject(TenantContextService) private readonly tenants?:TenantContextService) {}

  private hostScope<T>(merchantId:string,work:()=>Promise<T>):Promise<T> {
    const current=this.tenants?.get();
    if(current&&current.merchantId!==merchantId)fail("marketplace_asaas_residual_authorization_foreign_tenant");
    if(current||!this.tenants)return work();
    return this.tenants.run({merchantId,userId:"marketplace-asaas-residual",role:"system"},async()=>work());
  }
  private request(row:Row):AsaasMarketplaceResidualRequest|AsaasMarketplaceHostRetentionOutboundRequest {
    const request=row.request as unknown as AsaasMarketplaceResidualRequest|AsaasMarketplaceHostRetentionOutboundRequest,{requestHash,...raw}=request;
    if (![5,7].includes(request.version)||request.provider!=="asaas"||row.provider!=="asaas"||request.fundingPlanId!==row.residualPlan.fundingPlanId||
      request.asaasFunding.host.merchantId!==row.residualPlan.hostMerchantId||request.beneficiaryMerchantId!==row.beneficiaryMerchantId||
      request.requestHash!==row.requestHash||fundingHash(raw)!==requestHash||request.reference!==row.reference||
      request.amountCents!==row.amountCents||request.accountFingerprint!==row.accountFingerprint||row.sourceId!=="original"||
      request.basisHash!==row.residualPlan.basisHash||request.allocationHash!==row.residualPlan.allocationHash||
      fundingHash(row.residualPlan.basis)!==request.basisHash||fundingHash(row.residualPlan.allocation)!==request.allocationHash) {
      fail("marketplace_asaas_residual_authorization_changed");
    }
    return request;
  }
  private payload(row:Row,certificate?:{journalId:string;certificateHash:string;preflight:AsaasMarketplaceHostRetentionProof}) {
    return {residual_plan_id:row.residualPlanId,operation_id:row.id,payment_intent_id:row.residualPlan.fundingPlanId,request_hash:row.requestHash,
      ...(certificate?{host_retention_journal_id:certificate.journalId,host_retention_certificate_hash:certificate.certificateHash,
        host_retention_preflight:certificate.preflight as unknown as Prisma.InputJsonValue}:{})};
  }
  private async certificate(tx:Prisma.TransactionClient,row:Row,preflight?:AsaasMarketplaceHostRetentionProof,fresh=false) {
    const request=this.request(row);if(request.version!==7)return;
    const certificates=await tx.$queryRaw<Array<{id:string;request:AsaasMarketplaceHostRetentionRequest;proof:AsaasMarketplaceHostRetentionProof;certificate_hash:string}>>`
      SELECT id,request,proof,certificate_hash FROM marketplace_asaas_host_retentions WHERE id=${request.hostRetention.journalId}
      AND request_hash=${request.hostRetention.requestHash} AND residual_plan_id=${row.residualPlanId} AND status='certified'`;
    if(certificates.length!==1||!preflight)fail('marketplace_asaas_host_retention_preflight_missing');const c=certificates[0];
    if(!validAsaasMarketplaceHostRetentionProof(c.request,c.proof)||!validAsaasMarketplaceHostRetentionProof(c.request,preflight,fresh?new Date():undefined)||
      c.certificate_hash!==fundingHash({request:c.request,proof:c.proof}))fail('marketplace_asaas_host_retention_preflight_changed');
    const {observedAt:_stored,...stored}=c.proof,{observedAt:_fresh,...native}=preflight;
    if(fundingHash(stored)!==fundingHash(native))fail('marketplace_asaas_host_retention_preflight_changed');
    return {journalId:c.id,certificateHash:c.certificate_hash,preflight};
  }
  private async event(tx:Prisma.TransactionClient,row:Row) {
    const event=await tx.outboxMessage.findUnique({where:{eventId:asaasResidualSubmissionEventId(row.id)}});
    const certificate=event?await this.certificate(tx,row,(event.payload as unknown as {host_retention_preflight?:AsaasMarketplaceHostRetentionProof}).host_retention_preflight):undefined;
    if (event&&(event.eventType!=="marketplace.asaas_residual.submission_authorized"||event.schemaVersion!==1||event.producer!=="marketplace"||
      event.merchantId!==row.residualPlan.hostMerchantId||event.correlationId!==row.residualPlan.fundingPlanId||event.causationId!==row.id||
      fundingHash(event.payload)!==fundingHash(this.payload(row,certificate)))) fail("marketplace_asaas_residual_submission_event_changed");
    return event;
  }
  async read(requestHash:string) {
    const initial=await this.prisma.marketplaceResidualOperation.findFirst({where:{requestHash},include:{residualPlan:true}});
    if (!initial) return;
    return this.hostScope(initial.residualPlan.hostMerchantId,()=>this.prisma.$transaction(async tx=>{
      const request=this.request(initial);
      if (!await tx.paymentIntent.findFirst({where:{id:request.fundingPlanId,merchantId:initial.residualPlan.hostMerchantId},select:{id:true}})) return;
      await lockMarketplaceOrder(tx,initial.residualPlan.hostMerchantId,request.providerPaymentId);
      const row=await tx.marketplaceResidualOperation.findFirst({where:{id:initial.id,requestHash},include:{residualPlan:true}});
      if (!row||!row.claimedAt||!["unknown","pending","confirmed","failed"].includes(row.status)) return;
      this.request(row);const event=await this.event(tx,row);
      if (!event&&(row.status!=="unknown"||row.providerTransferId)) return;
      return {operationId:row.id,requestHash,state:event?"submitted" as const:"claimed" as const,
        ...(row.providerTransferId?{providerTransferId:row.providerTransferId}:{})};
    }));
  }
  async consumeSubmissionAuthorization(requestHash:string,preflight?:{hostRetentionProof:AsaasMarketplaceHostRetentionProof}) {
    const initial=await this.prisma.marketplaceResidualOperation.findFirst({where:{requestHash},include:{residualPlan:true}});
    if (!initial) return;
    return this.hostScope(initial.residualPlan.hostMerchantId,()=>this.prisma.$transaction(async tx=>{
      const request=this.request(initial);
      await lockMarketplaceOrder(tx,initial.residualPlan.hostMerchantId,request.providerPaymentId);
      await tx.$queryRaw`SELECT id FROM marketplace_residual_operations WHERE id=${initial.id} FOR UPDATE`;
      const row=await tx.marketplaceResidualOperation.findFirst({where:{id:initial.id,requestHash},include:{residualPlan:true}});
      if (!row||row.status!=="unknown"||!row.claimedAt||row.providerTransferId||row.residualPlan.status!=="prepared"||
        row.residualPlan.generation!==1||row.residualPlan.dueAt.getTime()>Date.now()) return;
      this.request(row);if (await this.event(tx,row)) return;
      const certificate=await this.certificate(tx,row,preflight?.hostRetentionProof,true);
      const beneficiary={merchantId:row.beneficiaryMerchantId,destination:request.destination,amountCents:row.amountCents};
      let current:AsaasMarketplaceResidualRequest|AsaasMarketplaceHostRetentionOutboundRequest;
      if(request.version===7) {
        const data=await readMarketplaceAsaasHostRetentionBasis(tx,row.residualPlan.hostMerchantId,row.residualPlan.fundingPlanId);
        current=buildMarketplaceAsaasHostRetentionOperationRequest(data,beneficiary,row.residualPlan.basisHash);
      }else {
        const data=await readMarketplaceAsaasResidualBasis(tx,row.residualPlan.hostMerchantId,row.residualPlan.fundingPlanId);
        current=buildMarketplaceAsaasResidualOperationRequest(data,beneficiary,row.residualPlan.basisHash);
      }
      if (fundingHash(current)!==fundingHash(request)) fail("marketplace_asaas_residual_basis_changed");
      await tx.outboxMessage.create({data:{eventId:asaasResidualSubmissionEventId(row.id),eventType:"marketplace.asaas_residual.submission_authorized",
        schemaVersion:1,merchantId:row.residualPlan.hostMerchantId,occurredAt:new Date(),correlationId:row.residualPlan.fundingPlanId,
        causationId:row.id,producer:"marketplace",payload:this.payload(row,certificate)}});
      return {operationId:row.id,requestHash,state:"submission_authorized" as const};
    },{maxWait:10000,timeout:15000}));
  }
}

/** Credentials are resolved from the exact journal-frozen merchant wallet.
 * Raw reads avoid projecting the collector's tenant onto a seller connection;
 * no caller-controlled query can select a different merchant or provider. */
@Injectable()
export class PrismaAsaasMarketplaceResidualAccountReader implements AsaasMarketplaceResidualAccountReader {
  constructor(@Inject(PrismaClient) private readonly prisma:PrismaClient) {}
  async read(account:AsaasMarketplaceResidualAccount) {
    const rows=await this.prisma.$queryRaw<Array<{merchant_id:string;provider:string;secret_cipher:string|null;wallet_id:string|null;environment:string;status:string;payouts_enabled:boolean}>>`
      SELECT merchant_id,provider,secret_cipher,wallet_id,environment,status,payouts_enabled FROM merchant_payment_connections
      WHERE merchant_id=${account.merchantId} AND provider='asaas'`;
    const row=rows[0];
    if (rows.length!==1||!row.secret_cipher||fundingHash({merchantId:row.merchant_id,provider:row.provider})!==account.connectionId||
      fundingHash(row.secret_cipher)!==account.secretCipherHash||row.wallet_id!==account.walletId||row.environment!==account.environment||
      row.status!=="active"||!row.payouts_enabled) return;
    const asaasKey=decryptPaymentSecret(row.secret_cipher!);
    if (marketplaceCaptureAccount("asaas",account.environment,asaasKey,account.asaasOrigin).accountFingerprint!==account.accountFingerprint) return;
    return {asaasKey,asaasOrigin:account.asaasOrigin};
  }
}
