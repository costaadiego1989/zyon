import { Injectable } from "@nestjs/common";
import { generateDeterministicReply } from "@aacp/conversation-engine";
import type { ConversationPort, ConversationReplyInput } from "../../domain/ports/conversation.port.js";

@Injectable()
export class DeterministicConversationAdapter implements ConversationPort {
  reply(input: ConversationReplyInput) {
    return Promise.resolve(generateDeterministicReply(input));
  }
}
