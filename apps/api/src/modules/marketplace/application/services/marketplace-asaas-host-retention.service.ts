import {Inject,Injectable} from '@nestjs/common';
import {PrismaAsaasMarketplaceHostRetentionRepository,ASAAS_MARKETPLACE_HOST_RETENTION_JOURNAL} from '../../infrastructure/repositories/prisma-asaas-marketplace-host-retention.repository.js';
export const MARKETPLACE_ASAAS_HOST_RETENTION_COORDINATOR=Symbol('MarketplaceAsaasHostRetentionCoordinator');

@Injectable()
export class MarketplaceAsaasHostRetentionService {
  constructor(@Inject(ASAAS_MARKETPLACE_HOST_RETENTION_JOURNAL)private readonly journal:PrismaAsaasMarketplaceHostRetentionRepository){}
  async certifyPlan(hostMerchantId:string,residualPlanId:string,now=new Date()) {
    return this.journal.certifyPlan(hostMerchantId,residualPlanId,now);
  }
  async recover(limit=20) {
    const rows=await this.journal.listDue(limit);let certified=0,held=0,failed=0;
    // One bounded native certification at a time; no provider financial POST.
    for(const row of rows)try {
      const result=await this.certifyPlan(row.host_merchant_id,row.residual_plan_id);
      if(result.state==='certified')certified++;else if(result.state==='held')held++;
    }catch {failed++;}
    return {attempted:rows.length,certified,held,failed};
  }
}
