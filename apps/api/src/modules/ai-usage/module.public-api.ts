import { Module } from "@nestjs/common";
import { RecordAiUsageUseCase } from "./public-api.js";
/** Recording-only public boundary; no voice, billing-worker or checkout imports. */
@Module({
  providers: [
    RecordAiUsageUseCase,
  ],
  exports: [RecordAiUsageUseCase],
})
export class AiUsageRecordingModule {}
