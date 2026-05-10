import { Body, Controller, Post } from "@nestjs/common";
import {
  SendSupportMessageUseCase,
  type SupportMessageInput,
} from "../../application/send-support-message.use-case.js";

@Controller("support")
export class SupportController {
  constructor(private readonly sendSupportMessage: SendSupportMessageUseCase) {}

  @Post("chat")
  chat(@Body() body: SupportMessageInput) {
    return this.sendSupportMessage.execute(body);
  }
}
