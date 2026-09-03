import { Module } from "@nestjs/common";
import { UcpDiscoveryController } from "./ucp-discovery.controller.js";

@Module({
  controllers: [UcpDiscoveryController],
})
export class UcpDiscoveryModule {}
