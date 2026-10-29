import { Inject, Injectable, Logger } from "@nestjs/common";
import { Counter, Gauge } from "prom-client";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { PrismaMarketplaceOperationalAlertRepository } from "./repositories/prisma-marketplace-operational-alert.repository.js";

@Injectable()
export class MarketplaceOperationalAlertMetrics {
  private readonly status:Gauge;private readonly oldest:Gauge;private readonly errors:Counter;private readonly collected:Gauge;
  private pending?:Promise<void>;
  private readonly logger=new Logger(MarketplaceOperationalAlertMetrics.name);
  constructor(@Inject(PrismaMarketplaceOperationalAlertRepository)private readonly repo:PrismaMarketplaceOperationalAlertRepository,
    @Inject(MetricsService)metrics:MetricsService) {
    const registers=[metrics.registry],collect=()=>this.refresh();
    this.status=new Gauge({name:"marketplace_operational_notification_deliveries",help:"Durable operational alert channel states; acceptance does not prove inbox delivery",labelNames:["channel","status"],registers,collect});
    this.oldest=new Gauge({name:"marketplace_operational_notification_oldest_pending_seconds",help:"Age of the oldest unresolved operational channel obligation",labelNames:["channel"],registers,collect});
    this.errors=new Counter({name:"marketplace_operational_notification_collection_errors_total",help:"Failed collection of operational notification journals",registers});
    this.collected=new Gauge({name:"marketplace_operational_notification_collected_timestamp_seconds",help:"Last successful operational notification journal collection",registers,collect});
    this.collected.set(0);
  }
  refresh() {
    if(this.pending)return this.pending;
    this.pending=this.collect().finally(()=>{this.pending=undefined;});return this.pending;
  }
  private async collect() {
    try {
      const rows=await this.repo.deliveryMetrics();
      const channels=["email","whatsapp","dashboard"],statuses=["pending","processing","sending","accepted","retryable_failed","failed","unknown"];
      for(const channel of channels){this.oldest.set({channel},0);for(const status of statuses)this.status.set({channel,status},0);}
      for(const r of rows){if(!channels.includes(r.channel)||!statuses.includes(r.status))continue;
        this.status.set({channel:r.channel,status:r.status},Number(r.count));
        if(r.status!=="accepted") {
          const existing=rows.filter(x=>x.channel===r.channel&&x.status!=="accepted").map(x=>Math.max(0,x.oldest_seconds));
          this.oldest.set({channel:r.channel},Math.max(0,...existing));
        }
      }
      this.collected.set(Date.now()/1000);
    } catch {this.errors.inc();this.logger.error("operational_alert_metrics_collection_failed");}
  }
}
