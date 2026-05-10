import { Module } from "@nestjs/common";
import { HttpModule } from "../../shared/http/http.module.js";
import { SendSupportMessageUseCase } from "./application/send-support-message.use-case.js";
import { SupportController } from "./presentation/http/support.controller.js";

@Module({
  imports: [HttpModule],
  controllers: [SupportController],
  providers: [SendSupportMessageUseCase],
})
export class SupportModule {}
