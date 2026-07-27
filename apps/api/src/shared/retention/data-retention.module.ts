import { Global, Module } from "@nestjs/common";
import { DataRetentionService } from "./data-retention.service.js";

@Global()
@Module({
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
