import {Inject,Injectable,Optional} from '@nestjs/common';
import {PrismaClient,type Prisma} from '@prisma/client';
import {TenantContextService} from '../../../../shared/tenant/tenant-context.service.js';
import type {AsaasMarketplaceHostRetentionRequest,AsaasMarketplaceHostRetentionProof,AsaasMarketplaceHostRetentionJournal,
  AsaasMarketplaceHostRetentionVerifier} from '../../domain/ports/asaas-marketplace-host-retention.port.js';
import {asaasHostRetentionJournalId,asaasHostRetentionEventId,validAsaasMarketplaceHostRetentionRequest,validAsaasMarketplaceHostRetentionProof} from '../../domain/services/asaas-marketplace-host-retention.js';
import {fundingHash,lockMarketplaceOrder} from './prisma-marketplace-funding.repository.js';
import {readMarketplaceAsaasHostRetentionBasis} from './asaas-marketplace-residual-basis.js';

export const ASAAS_MARKETPLACE_HOST_RETENTION_VERIFIER=Symbol('AsaasMarketplaceHostRetentionVerifier');
export const ASAAS_MARKETPLACE_HOST_RETENTION_JOURNAL=Symbol('AsaasMarketplaceHostRetentionJournal');
type Row={id:string;residual_plan_id:string;host_merchant_id:string;funding_plan_id:string;request_hash:string;
  request:AsaasMarketplaceHostRetentionRequest;status:'planned'|'certified';proof:AsaasMarketplaceHostRetentionProof|null;certificate_hash:string|null};
function fail():never {throw Error('marketplace_asaas_host_retention_journal_changed');}

/** Called inside the SAME preparation transaction and existing order lock. */
export async function prepareAsaasMarketplaceHostRetentionJournal(tx:Prisma.TransactionClient,
  plan:{id:string;hostMerchantId:string;fundingPlanId:string},request:AsaasMarketplaceHostRetentionRequest):Promise<string> {
  if(!validAsaasMarketplaceHostRetentionRequest(request)||plan.hostMerchantId!==request.host.merchantId||plan.fundingPlanId!==request.fundingPlanId)fail();
  const id=asaasHostRetentionJournalId(request.requestHash);
  await tx.$executeRaw`INSERT INTO marketplace_asaas_host_retentions(id,residual_plan_id,host_merchant_id,funding_plan_id,request_hash,request,status)
    VALUES(${id},${plan.id},${plan.hostMerchantId},${plan.fundingPlanId},${request.requestHash},${JSON.stringify(request)}::jsonb,'planned')
    ON CONFLICT(residual_plan_id) DO NOTHING`;
  const rows=await tx.$queryRaw<Row[]>`SELECT * FROM marketplace_asaas_host_retentions WHERE residual_plan_id=${plan.id}`;
  if(rows.length!==1||rows[0].id!==id||rows[0].request_hash!==request.requestHash||fundingHash(rows[0].request)!==fundingHash(request))fail();
  return id;
}

@Injectable()
export class PrismaAsaasMarketplaceHostRetentionRepository implements AsaasMarketplaceHostRetentionJournal {
  constructor(@Inject(PrismaClient)private readonly prisma:PrismaClient,
    @Inject(ASAAS_MARKETPLACE_HOST_RETENTION_VERIFIER)private readonly verifier:AsaasMarketplaceHostRetentionVerifier,
    @Optional()@Inject(TenantContextService)private readonly tenants?:TenantContextService){}
  private hostScope<T>(merchantId:string,work:()=>Promise<T>):Promise<T> {
    const current=this.tenants?.get();
    if(current&&current.merchantId!==merchantId)fail();
    if(current||!this.tenants)return work();
    return this.tenants.run({merchantId,userId:'marketplace-asaas-host-retention',role:'system'},async()=>work());
  }
  private valid(row:Row):void {
    if(!validAsaasMarketplaceHostRetentionRequest(row.request)||row.id!==asaasHostRetentionJournalId(row.request_hash)||
      row.request_hash!==row.request.requestHash||row.host_merchant_id!==row.request.host.merchantId||row.funding_plan_id!==row.request.fundingPlanId||
      row.status==='certified'&&(!row.proof||!validAsaasMarketplaceHostRetentionProof(row.request,row.proof)||
        row.certificate_hash!==fundingHash({request:row.request,proof:row.proof})))fail();
  }
  async read(pointer:{journalId:string;requestHash:string}) {
    const rows=await this.prisma.$queryRaw<Row[]>`SELECT * FROM marketplace_asaas_host_retentions WHERE id=${pointer.journalId} AND request_hash=${pointer.requestHash}`;
    if(rows.length!==1)return;const row=rows[0];this.valid(row);
    return this.hostScope(row.host_merchant_id,async()=>{
      if(row.status!=='certified'||!row.proof||!row.certificate_hash||!await this.prisma.paymentIntent.findFirst({where:{id:row.funding_plan_id,merchantId:row.host_merchant_id},select:{id:true}}))return;
      return {journalId:row.id,request:row.request,proof:row.proof,certificateHash:row.certificate_hash};
    });
  }
  async listDue(limit=20,now=new Date()) {
    return this.prisma.$queryRaw<Array<{residual_plan_id:string;host_merchant_id:string}>>`
      SELECT j.residual_plan_id,j.host_merchant_id FROM marketplace_asaas_host_retentions j
      JOIN marketplace_residual_plans p ON p.id=j.residual_plan_id WHERE p.status='prepared' AND p.due_at<=${now}
      ORDER BY p.updated_at,p.id LIMIT ${Math.min(100,Math.max(1,Math.floor(limit)))}`;
  }
  async certify(residualPlanId:string) {
    const rows=await this.prisma.$queryRaw<Row[]>`SELECT * FROM marketplace_asaas_host_retentions WHERE residual_plan_id=${residualPlanId}`;
    if(rows.length!==1)fail();return this.certifyPlan(rows[0].host_merchant_id,residualPlanId,new Date());
  }
  async certifyPlan(hostMerchantId:string,residualPlanId:string,now=new Date()):Promise<{state:'certified'|'unproven'|'held';journalId:string;outboundOperations:number}> {
    return this.hostScope(hostMerchantId,async()=>{
      const rows=await this.prisma.$queryRaw<Row[]>`SELECT * FROM marketplace_asaas_host_retentions WHERE residual_plan_id=${residualPlanId} AND host_merchant_id=${hostMerchantId}`;
      if(rows.length!==1||!await this.prisma.paymentIntent.findFirst({where:{id:rows[0].funding_plan_id,merchantId:hostMerchantId},select:{id:true}}))fail();
      const initial=rows[0];this.valid(initial);
      const operationCount=await this.prisma.marketplaceResidualOperation.count({where:{residualPlanId}});
      const seen=await this.verifier.certify(initial.request);
      if(seen.state!=='certified'||!validAsaasMarketplaceHostRetentionProof(initial.request,seen.proof,now))return {state:'unproven',journalId:initial.id,outboundOperations:operationCount};
      return this.prisma.$transaction(async tx=>{
        await lockMarketplaceOrder(tx,hostMerchantId,initial.request.capture.providerPaymentId);
        const locked=await tx.$queryRaw<Row[]>`SELECT * FROM marketplace_asaas_host_retentions WHERE residual_plan_id=${residualPlanId} AND host_merchant_id=${hostMerchantId} FOR UPDATE`;
        if(locked.length!==1)fail();const row=locked[0];this.valid(row);
        if(fundingHash(row.request)!==fundingHash(initial.request))fail();
        const plan=await tx.marketplaceResidualPlan.findFirst({where:{id:residualPlanId,hostMerchantId}});
        if(!plan||plan.generation!==1||plan.basisHash!==row.request.basisHash||plan.allocationHash!==row.request.allocationHash||
          fundingHash(plan.basis)!==row.request.basisHash||fundingHash(plan.allocation)!==row.request.allocationHash)fail();
        let heldReason=plan.heldReason;
        try {
          const fresh=await readMarketplaceAsaasHostRetentionBasis(tx,hostMerchantId,row.funding_plan_id);
          if(fundingHash(fresh.basis)!==row.request.basisHash||fundingHash(fresh.allocation)!==row.request.allocationHash)fail();
        }catch {heldReason=heldReason??'marketplace_asaas_host_retention_financial_reconciliation_required';}
        if(row.status==='certified') {
          const {observedAt:_old,...oldProof}=row.proof!,{observedAt:_fresh,...freshProof}=seen.proof;
          if(fundingHash(oldProof)!==fundingHash(freshProof))fail();
        }else {
          const certificateHash=fundingHash({request:row.request,proof:seen.proof});
          await tx.$executeRaw`UPDATE marketplace_asaas_host_retentions SET status='certified',proof=${JSON.stringify(seen.proof)}::jsonb,
            certificate_hash=${certificateHash},certified_at=${now} WHERE id=${row.id} AND status='planned'`;
          await tx.outboxMessage.create({data:{eventId:asaasHostRetentionEventId(row.id),eventType:'marketplace.asaas_host_retention.certified',schemaVersion:1,
            merchantId:hostMerchantId,occurredAt:now,correlationId:row.funding_plan_id,causationId:row.id,producer:'marketplace',payload:{journal_id:row.id,
              residual_plan_id:residualPlanId,payment_intent_id:row.funding_plan_id,request_hash:row.request_hash,certificate_hash:certificateHash,
              asaas_retention_proof:seen.proof as unknown as Prisma.InputJsonValue,reconciliation_required:!!heldReason}}});
        }
        const operations=await tx.marketplaceResidualOperation.findMany({where:{residualPlanId}});
        if(heldReason)await tx.marketplaceResidualPlan.update({where:{id:residualPlanId},data:{status:'held',heldReason}});
        else if(plan.status==='prepared'&&plan.dueAt<=now&&operations.every(o=>o.status==='confirmed')) {
          await tx.marketplaceResidualPlan.update({where:{id:residualPlanId},data:{status:'completed'}});
        }
        return {state:heldReason?'held' as const:'certified' as const,journalId:row.id,outboundOperations:operations.length};
      },{maxWait:10000,timeout:15000});
    });
  }
}
