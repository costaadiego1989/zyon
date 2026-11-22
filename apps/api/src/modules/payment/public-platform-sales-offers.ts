import {createHash} from "node:crypto";
import {BILLING_PLANS,BILLING_PLAN_PRESENTATION,type ProspectOffer} from "@zyon/shared-types";
import {quoteBilling} from "./infrastructure/billing-offers.js";
export class PlatformSalesOffers {
  private readonly origin:string;
  private readonly site:string|null;
  constructor(dashboardOrigin:string,publicSiteUrl?:string){
    const site=publicSiteUrl?new URL(publicSiteUrl):null;
    if(site && (site.protocol!=="https:"||site.username||site.password||site.search||site.hash))throw Error("invalid_public_site");
    this.site=site?.href??null;
    const url=new URL(dashboardOrigin);
    if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw Error("invalid_dashboard_origin");
    this.origin=url.origin;
  }
  private url(plan:string){return this.origin+"/?mode=signup&plan="+encodeURIComponent(plan);}
  publicSite(){return this.site;}
  allowedUrl(url:string){return url===this.site || Object.keys(BILLING_PLANS).some(plan=>this.url(plan)===url);}
  async current(planKey:string):Promise<ProspectOffer>{
    if(!Object.hasOwn(BILLING_PLANS,planKey))throw Error("invalid_plan");
    const key=planKey as keyof typeof BILLING_PLANS,quote=quoteBilling(key);
    const offer={planKey,name:BILLING_PLANS[key].name,price:{amountCents:quote.amountCents,currency:"BRL"},billingCycle:quote.cycle,
      features:[...BILLING_PLAN_PRESENTATION[key].highlights],canonicalUrl:this.url(key)};
    return {...offer,version:createHash("sha256").update(JSON.stringify(offer)).digest("hex")};
  }
}
