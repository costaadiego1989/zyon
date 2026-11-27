import { Injectable, Optional } from "@nestjs/common";
import { AiMeteringService } from "../ai-metering/ai-metering.service.js";
import { providerName } from "../ai-metering/usage.js";

export interface AiUsageCapture {
  idempotencyKey:string; merchantId:string; source:string; channel:string; component:string; provider:string; model:string;
  executionStatus:string; promptTokens?:number; completionTokens?:number; totalTokens?:number; providerEventId?:string;
  startedAt:Date; completedAt:Date; latencyMs:number; conversationId?:string; correlationId?:string; recordingId?:string;
}
@Injectable()
export class RecordAiUsageUseCase {
  constructor(@Optional() private readonly metering?:AiMeteringService) {}

  /** Admission and the durable unknown marker precede the paid provider call. */
  async begin(input:Pick<AiUsageCapture,"idempotencyKey"|"merchantId"|"source"|"provider"|"model"|"conversationId">):Promise<string> {
    if (!this.metering) throw new Error("ai_metering_not_initialized");
    const row=await this.metering.begin({merchantId:input.merchantId,source:input.source,conversationId:input.conversationId,costCenter:"automation"},
      providerName(`https://${input.provider}/v1/chat/completions`),input.model,"platform:marketing","chat","text_generation",input.idempotencyKey);
    return row.id;
  }
  async execute(input:AiUsageCapture):Promise<void> {
    if (!this.metering) throw new Error("ai_metering_not_initialized");
    const id=input.recordingId ?? await this.begin(input);
    await this.metering.completeSafely({id,status:input.executionStatus,endedAt:input.completedAt.toISOString(),payload:{
      model:input.model,id:input.providerEventId,usage:{prompt_tokens:input.promptTokens,completion_tokens:input.completionTokens,total_tokens:input.totalTokens},
    }});
  }
}
