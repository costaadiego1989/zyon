import { Global, Module } from "@nestjs/common";
import { BuyerChannelIdentityService } from "./application/services/buyer-channel-identity.service.js";

@Global()
@Module({ providers: [BuyerChannelIdentityService], exports: [BuyerChannelIdentityService] })
export class BuyerChannelIdentityModule {}
