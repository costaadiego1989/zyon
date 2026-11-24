import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { ConnectPlatformSenderCommand, PlatformSenderBinding, PlatformSenderSignupState } from "@zyon/shared-types";
import type { MetaCloudAuthorizedAssets, WhatsAppSignupAuthorization } from "../../../whatsapp-channel/domain/ports/whatsapp-signup-authorization.port.js";
import type { ProspectingActor } from "../../domain/prospecting.ports.js";

export interface PlatformSignupConfig {
  appId: string; configId: string; businessId: string; phoneNumberId: string;
  encryptionKey: string; appSecret: string; registrationPin?: string;
  wabaId?: string; systemUserId?: string; systemUserAccessToken?: string;
}
export interface SenderBindingStore {
  binding(): Promise<PlatformSenderBinding | null>;
  issueState(actor: ProspectingActor, clientRequestId: string, mint: () => {nonce:string;expiresAt:string;stateHash:string}):Promise<{nonce:string;expiresAt:string}>;
  connect(command: ConnectPlatformSenderCommand, actor: ProspectingActor, config: PlatformSignupConfig, authorize: () => Promise<MetaCloudAuthorizedAssets>): Promise<PlatformSenderBinding>;
}
const hash = (state: string) => createHash("sha256").update(state).digest("hex");
export class PlatformSenderOnboardingService {
  constructor(private readonly config: PlatformSignupConfig, private readonly store: SenderBindingStore, private readonly authorization: WhatsAppSignupAuthorization & {authorizeSystemUser?:()=>Promise<MetaCloudAuthorizedAssets>}) {
    if (![config.appId, config.configId].every(id => /^\d+$/.test(id)) || [config.businessId,config.phoneNumberId].some(id => id !== "" && !/^\d+$/.test(id)) || !config.appSecret || !/^[a-f0-9]{64}$/i.test(config.encryptionKey)) throw new Error("sender_unavailable");
  }
  async signupState(actor: ProspectingActor, clientRequestId:string=randomUUID()): Promise<PlatformSenderSignupState> {
    const own=!!this.config.systemUserAccessToken;
    const asset=own?await this.ownAuthorization():null;
    const prefix=own?"system_user|":"";
    const sign=(nonce:string)=>nonce+"."+createHmac("sha256",this.config.encryptionKey).update(actor.operatorId+"|"+prefix+nonce).digest("base64url");
    const receipt=await this.store.issueState(actor,clientRequestId,()=>{
      const nonce=randomBytes(32).toString("base64url");
      return {nonce,expiresAt:new Date(Date.now()+600_000).toISOString(),stateHash:hash(prefix+sign(nonce))};
    });
    return {state:sign(receipt.nonce),expiresAt:receipt.expiresAt,appId:this.config.appId,configId:this.config.configId,signupVersion:"v5",extras:{version:"v5",features:[{name:"whatsapp_business_app_onboarding",enabled:false}]},...(asset?{authorizationMethod:"system_user" as const,existingSender:{businessId:this.config.businessId,wabaId:asset.wabaId,phoneNumberId:asset.phoneNumberId,displayPhoneNumber:asset.whatsappNumber}}:{})};
  }
  private ownAuthorization(){
    if(!this.config.systemUserAccessToken||!this.authorization.authorizeSystemUser)throw Error("sender_unavailable");
    return this.authorization.authorizeSystemUser();
  }
  connect(command: ConnectPlatformSenderCommand, actor: ProspectingActor) {
    if("authorizationMethod" in command){
      return this.store.connect(command,actor,this.config,async()=>{
        if(command.authorizationMethod!=="system_user"||Object.keys(command).some(k=>!["authorizationMethod","state","clientRequestId"].includes(k)))throw Error("sender_identity_mismatch");
        const asset=await this.ownAuthorization();
        if(!await this.authorization.isSubscribed(asset))await this.authorization.subscribe(asset);
        return asset;
      });
    }
    const selectedConfig={...this.config,businessId:this.config.businessId||command.businessId,phoneNumberId:this.config.phoneNumberId||command.phoneNumberId};
    return this.store.connect(command, actor, selectedConfig, async () => {
      if (typeof command.state !== "string" || command.state.length > 128) throw new Error("signup_state_invalid");
      if (!command.code || typeof command.code !== "string" || command.code.length > 4096 || ![command.businessId,command.phoneNumberId,command.wabaId].every(id=>typeof id === "string" && /^\d+$/.test(id)) || selectedConfig.businessId !== command.businessId || selectedConfig.phoneNumberId !== command.phoneNumberId || command.isOnBizApp !== false || !Array.isArray(command.messagingAccountIds) || !command.messagingAccountIds.includes(command.wabaId)) throw new Error("sender_identity_mismatch");
      const asset = await this.authorization.authorize(command);
      if (asset.phoneNumberId !== command.phoneNumberId || asset.wabaId !== command.wabaId) throw new Error("sender_identity_mismatch");
      if (!await this.authorization.isSubscribed(asset)) await this.authorization.subscribe(asset);
      if (!asset.phoneRegistered) {
        if (!this.config.registrationPin) throw new Error("sender_registration_required");
        await this.authorization.registerPhone(asset,this.config.registrationPin);
        if (!await this.authorization.isPhoneRegistered(asset)) throw new Error("sender_registration_required");
      }
      return asset;
    });
  }
}
