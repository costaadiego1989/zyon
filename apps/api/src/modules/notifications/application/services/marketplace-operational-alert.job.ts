import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaMarketplaceOperationalAlertRepository } from "../../infrastructure/repositories/prisma-marketplace-operational-alert.repository.js";
import { MarketplaceOperationalAlertSender } from "../../infrastructure/adapters/marketplace-operational-alert.sender.js";
import type { OperationalAlertDeliveryResult } from "../../domain/marketplace-operational-alert.js";

@Injectable()
export class MarketplaceOperationalAlertJob implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running=false;
  private readonly logger=new Logger(MarketplaceOperationalAlertJob.name);
  constructor(@Inject(PrismaMarketplaceOperationalAlertRepository) private readonly repo:PrismaMarketplaceOperationalAlertRepository,
    @Inject(MarketplaceOperationalAlertSender) private readonly sender:MarketplaceOperationalAlertSender) {}
  onModuleInit() { this.timer=setInterval(()=>void this.run(),10000);this.timer.unref(); }
  onModuleDestroy() { if(this.timer)clearInterval(this.timer); }
  async run(clock:()=>Date=()=>new Date()) {
    if(this.running)return;
    this.running=true;
    try {
      await this.repo.expireSending(clock());
      for(let n=0;n<50;n++) {
        const claim=await this.repo.claim(clock());if(!claim)break;
        let result:OperationalAlertDeliveryResult, sending=false;
        try {
          const prepared=await this.sender.prepare(claim.alert,claim.channel);
          if(!("send" in prepared))result=prepared;
          else {
            if(!await this.repo.begin(claim,clock()))continue;
            sending=true;
            result=await withDeadline(prepared.send);
          }
        } catch { result={status:sending?"unknown":"retryable_failed",reason:sending?"provider_acceptance_unknown":"operational_preparation_failed"}; }
        // The local inbox has a deterministic unique ID. A lost local response
        // can be retried even when an external provider response cannot.
        if(claim.channel==="dashboard"&&result.status==="unknown")result={status:"retryable_failed",reason:"dashboard_persistence_unavailable"};
        if(result.status==="retryable_failed"&&claim.attempts>=12)result={...result,status:"failed"};
        const saved=await this.repo.finish(claim,result,clock());
        if(!saved||["unknown","failed"].includes(result.status))this.logger.error(`operational_alert_delivery_attention channel=${claim.channel} status=${saved?result.status:"lease_lost"}`);
      }
    } catch {this.logger.error("operational_alert_delivery_cycle_failed");}
    finally {this.running=false;}
  }
}
async function withDeadline(send:()=>Promise<OperationalAlertDeliveryResult>) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([Promise.resolve().then(send),new Promise<OperationalAlertDeliveryResult>(resolve=>{
    timer=setTimeout(()=>resolve({status:"unknown",reason:"provider_timeout"}),40000);
  })]);} finally {if(timer)clearTimeout(timer);}
}
