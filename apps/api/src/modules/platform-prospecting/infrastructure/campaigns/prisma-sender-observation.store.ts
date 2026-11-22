import type {PrismaClient} from "@prisma/client";
import type {ContactPermissionStatus,PlatformSenderBinding,PlatformSenderReadiness} from "@zyon/shared-types";
import {decryptPii} from "../../../../shared/crypto/pii-cipher.service.js";
import type {SenderObservationStore} from "../../application/campaigns/sender-readiness.service.js";
import {contactPermission} from "../../domain/crm/prospect-contact.js";
import {publicSender} from "./prisma-sender-binding.repository.js";
export class PrismaSenderObservationStore implements SenderObservationStore {
 constructor(private readonly prisma:PrismaClient,private readonly key:string){if(!/^[a-f0-9]{64}$/i.test(key))throw new Error("sender_unavailable");}
 async credential(){
  const row=await this.prisma.platformProspectSenderBinding.findFirst({where:{active:true,scope:"zyon_platform"}});if(!row)return null;
  const grants=row.grantedAssets as {businessId?:string;expiresAt?:string|null}|null;
  if(!grants||typeof grants.businessId!=="string"||!/^\d+$/.test(grants.businessId)||![row.appId,row.wabaId,row.phoneNumberId].every(id=>/^\d+$/.test(id))||grants.expiresAt!=null&&!(Date.parse(grants.expiresAt)>Date.now()))return null;
  return {binding:publicSender(row),businessId:grants.businessId,accessToken:decryptPii(row.encryptedCredentials,{AACP_PII_ENC_KEY:this.key})};
 }
 async save(binding:PlatformSenderBinding,result:PlatformSenderReadiness){
  const observed=new Date(result.updatedAt);
  return (await this.prisma.platformProspectSenderBinding.updateMany({where:{id:binding.id,scope:"zyon_platform",active:true,version:binding.version,OR:[{healthUpdatedAt:null},{healthUpdatedAt:{lte:observed}}]},data:{health:JSON.parse(JSON.stringify(result)),healthUpdatedAt:observed}})).count===1;
 }
 async permission(senderBindingId:string,endpointId:string){
  const scope={senderBindingId,endpointId,purpose:"zyon_sales"};
  const ep=await this.prisma.prospectEndpoint.findFirst({where:{id:endpointId,senderBindingId},select:{id:true}});if(!ep)throw new Error("endpoint_not_found");
  const receipts=await this.prisma.contactPermissionReceipt.findMany({where:scope});
  return contactPermission(scope,receipts.map(r=>({...r,status:r.status as ContactPermissionStatus})));
 }
}
