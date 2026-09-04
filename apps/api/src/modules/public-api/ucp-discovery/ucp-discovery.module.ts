import { Module } from "@nestjs/common";
import { MerchantModule } from "../../merchant/merchant.module.js";
import { UcpDiscoveryController } from "./ucp-discovery.controller.js";
import { UcpRobotsController } from "./ucp-robots.controller.js";

@Module({
  imports: [MerchantModule],
  controllers: [UcpDiscoveryController, UcpRobotsController],
})
export class UcpDiscoveryModule {}
