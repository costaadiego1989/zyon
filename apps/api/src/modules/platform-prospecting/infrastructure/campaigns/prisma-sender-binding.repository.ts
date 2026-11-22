import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type PlatformProspectSenderBinding } from "@prisma/client";
import type { PlatformSenderBinding, ConnectPlatformSender } from "@zyon/shared-types";
import type { MetaCloudAuthorizedAssets } from "../../../whatsapp-channel/domain/ports/whatsapp-signup-authorization.port.js";
import { encryptPii } from "../../../../shared/crypto/pii-cipher.service.js";
import type { PlatformSignupConfig, SenderBindingStore } from "../../application/campaigns/platform-sender-onboarding.service.js";
import type { ProspectingActor } from "../../domain/prospecting.ports.js";
import { prospectAudit, prospectCommand } from "../crm/prospect-command.js";

export function publicSender(row: PlatformProspectSenderBinding): PlatformSenderBinding {
  const {id,version,appId,wabaId,phoneNumberId,displayPhoneNumber,authorizationVersion,connectedBy,connectedAt} = row;
  return {id,version,appId,wabaId,phoneNumberId,displayPhoneNumber,authorizationVersion,connectedBy,connectedAt:connectedAt.toISOString()};
}
export class PrismaSenderBindingRepository implements SenderBindingStore {
  constructor(private readonly prisma: PrismaClient, private readonly encryptionKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) throw new Error("sender_unavailable");
  }
  async binding() {
    const row = await this.prisma.platformProspectSenderBinding.findFirst({where:{active:true,scope:"zyon_platform"}});
    return row && publicSender(row);
  }
  issueState(actor:ProspectingActor,clientRequestId:string,mint:()=>{nonce:string;expiresAt:string;stateHash:string}){
    return prospectCommand(this.prisma,"platform_sender_signup_state",{clientRequestId},actor,async tx=>{
      const {nonce,expiresAt,stateHash}=mint(),id=randomUUID();
      await tx.prospectSenderSignupState.create({data:{id,stateHash,operatorId:actor.operatorId,expiresAt:new Date(expiresAt)}});
      await prospectAudit(tx,actor,"sender.signup_state","sender_signup_state",id,1);
      return {result:{nonce,expiresAt},resourceIds:[id]};
    });
  }
  async consume(stateHash:string,operatorId:string) {
    // A failed exchange burns the nonce independently of the binding transaction.
    const used = await this.prisma.prospectSenderSignupState.updateMany({where:{stateHash,operatorId,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
    if (!used.count) throw new Error("signup_state_invalid");
  }
  connect(command:ConnectPlatformSender,actor:ProspectingActor,config:PlatformSignupConfig,authorize:()=>Promise<MetaCloudAuthorizedAssets>) {
    return prospectCommand(this.prisma,"platform_sender_connect",command,actor,async tx=>{
      const asset = await authorize();
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('zyon_platform_sender'))::text`;
      const rows=tx.platformProspectSenderBinding;
      const where={scope:"zyon_platform"};
      // The provider verified this E.164 number on this portfolio. App, messaging account and node IDs are authorization versions.
      const matches=await rows.findMany({where:{...where,displayPhoneNumber:asset.whatsappNumber,grantedAssets:{path:["businessId"],equals:config.businessId}},take:2});
      if(matches.length>1)throw new Error("sender_identity_mismatch");
      const previous=matches[0];
      const max=await rows.aggregate({where,_max:{version:true}});
      await rows.updateMany({where:{...where,active:true},data:{active:false}});
      const data={...where,active:true,version:(max._max.version??0)+1,authorizationVersion:(previous?.authorizationVersion??0)+1,appId:config.appId,wabaId:asset.wabaId,phoneNumberId:asset.phoneNumberId,displayPhoneNumber:asset.whatsappNumber,
        grantedAssets:{configId:config.configId,businessId:config.businessId,scopes:["whatsapp_business_management","whatsapp_business_messaging"],expiresAt:asset.tokenExpiresAt?.toISOString()??null},
        connectedBy:actor.operatorId,connectedAt:new Date(),encryptedCredentials:encryptPii(asset.accessToken,{AACP_PII_ENC_KEY:this.encryptionKey}),health:Prisma.DbNull,healthUpdatedAt:null};
      const saved=previous?await rows.update({where:{id:previous.id},data}):await rows.create({data});
      await prospectAudit(tx,actor,"sender_connected","sender",saved.id,saved.version);
      return {result:publicSender(saved),resourceIds:[saved.id]};
    });
  }
}
