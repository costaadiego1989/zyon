import {Controller,Get,Inject,Query,UseGuards} from "@nestjs/common";
import {type ProspectMetricName} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import {ProspectOperationalStatus} from "../application/crm/prospect-operational-status.js";
export {ProspectOperationalStatus};
import {ProspectMetricsQueryService} from "../application/crm/prospect-metrics.query.js";
import {prospectingHttpError,requestKeys,requestText,requestLimit} from "./prospecting-http-error.js";

@Controller("platform/prospecting")
@UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectMetricsController {
 constructor(@Inject(ProspectMetricsQueryService)private readonly metrics:ProspectMetricsQueryService,
  @Inject(ProspectOperationalStatus)private readonly status:ProspectOperationalStatus){}
 @Get("metrics") async funnel(@Query() q:Record<string,unknown>){
  try{requestKeys(q,["campaignId","from","to"]);return await this.metrics.execute({campaignId:requestText(q.campaignId,"campaignId"),from:requestText(q.from,"from",40)??"",to:requestText(q.to,"to",40)??""});}catch(e){prospectingHttpError(e);}
 }
 @Get("metrics/records") async records(@Query() q:Record<string,unknown>){
  try{requestKeys(q,["campaignId","from","to","metric","cursor","limit"]);return await this.metrics.records({campaignId:requestText(q.campaignId,"campaignId"),from:requestText(q.from,"from",40)??"",to:requestText(q.to,"to",40)??"",metric:requestText(q.metric,"metric",40) as ProspectMetricName,cursor:requestText(q.cursor,"cursor",2048),limit:requestLimit(q.limit)});}catch(e){prospectingHttpError(e);}
 }
 @Get("readiness") async readiness(@Query() q:Record<string,unknown>){try{requestKeys(q,[]);return await this.status.readiness();}catch(e){prospectingHttpError(e);}}
 @Get("config") config(@Query() q:Record<string,unknown>){try{requestKeys(q,[]);return this.status.config();}catch(e){prospectingHttpError(e);}}
 @Get("offers") async offers(@Query() q:Record<string,unknown>){try{requestKeys(q,[]);return await this.status.offers();}catch(e){prospectingHttpError(e);}}
}
