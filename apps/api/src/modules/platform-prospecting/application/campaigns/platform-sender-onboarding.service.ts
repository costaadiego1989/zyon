import { createHash, createHmac, randomBytes } from "node:crypto";
import type { ConnectPlatformSender, PlatformSenderBinding, PlatformSenderSignupState } from "@zyon/shared-types";
import type { MetaCloudAuthorizedAssets, WhatsAppSignupAuthorization } from "../../../whatsapp-channel/domain/ports/whatsapp-signup-authorization.port.js";
import type { ProspectingActor } from "../../domain/prospecting.ports.js";

export interface PlatformSignupConfig {
  appId: string; configId: string; businessId: string; phoneNumberId: string;
  encryptionKey: string; appSecret: string; registrationPin?: string;
}
export interface SenderBindingStore {
  binding(): Promise<PlatformSenderBinding | null>;
  saveState(hash: string, operatorId: string, expiresAt: Date): Promise<void>;
  consume(hash: string, operatorId: string): Promise<void>;
  connect(command: ConnectPlatformSender, actor: ProspectingActor, config: PlatformSignupConfig, authorize: () => Promise<MetaCloudAuthorizedAssets>): Promise<PlatformSenderBinding>;
}
const hash = (state: string) => createHash("sha256").update(state).digest("hex");
export class PlatformSenderOnboardingService {
  constructor(private readonly config: PlatformSignupConfig, private readonly store: SenderBindingStore, private readonly authorization: WhatsAppSignupAuthorization) {
    if (![config.appId, config.configId, config.businessId, config.phoneNumberId].every(id => /^\d+$/.test(id)) || !config.appSecret || !/^[a-f0-9]{64}$/i.test(config.encryptionKey)) throw new Error("sender_unavailable");
  }
  async signupState(actor: ProspectingActor): Promise<PlatformSenderSignupState> {
    const nonce = randomBytes(32).toString("base64url");
    const state = nonce + "." + createHmac("sha256", this.config.encryptionKey).update(actor.operatorId + "|" + nonce).digest("base64url");
    const expiresAt = new Date(Date.now() + 600_000);
    await this.store.saveState(hash(state), actor.operatorId, expiresAt);
    return { state, expiresAt: expiresAt.toISOString(), appId: this.config.appId, configId: this.config.configId, signupVersion: "v5", extras: { version:"v5",features:[{name:"whatsapp_business_app_onboarding",enabled:false}] } };
  }
  connect(command: ConnectPlatformSender, actor: ProspectingActor) {
    return this.store.connect(command, actor, this.config, async () => {
      if (typeof command.state !== "string" || command.state.length > 128) throw new Error("signup_state_invalid");
      await this.store.consume(hash(command.state), actor.operatorId);
      if (!command.code || typeof command.code !== "string" || command.code.length > 4096 || this.config.businessId !== command.businessId || this.config.phoneNumberId !== command.phoneNumberId || command.isOnBizApp !== false || !/^\d+$/.test(command.wabaId) || !Array.isArray(command.messagingAccountIds) || !command.messagingAccountIds.includes(command.wabaId)) throw new Error("sender_identity_mismatch");
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
