import { BadRequestException } from "@nestjs/common";
import type { ChatMessageRequest } from "@zyon/shared-types";
import { createHash } from "node:crypto";

/** Raw UTF-8 digest, also reproducible by the database evidence guard. */
export function chatMessageTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function chatRequestsEnabled(merchantId: string): boolean {
  return process.env.CHECKOUT_CHAT_REQUESTS_ENABLED === "true"
    && (process.env.CHECKOUT_CHAT_REQUEST_MERCHANT_IDS ?? "").split(",").map(id => id.trim())
      .filter(id => id && id !== "*").includes(merchantId);
}

/** Explicitly bind every field consumed by the use case. Never hash/log plaintext with PII alongside it. */
export function chatMessageIdentity(input: ChatMessageRequest) {
  if (typeof input.message_id !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(input.message_id)) {
    throw new BadRequestException({ code: "CHAT_MESSAGE_ID_REQUIRED", message: "message_id must be a stable 16-128 character identifier" });
  }
  for (const key of ["merchant_id", "session_id", "conversation_id"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 200) {
      throw new BadRequestException({ code: "CHAT_MESSAGE_INVALID_INPUT", field: key });
    }
  }
  if (typeof input.user_message !== "string" || !input.user_message.trim() || input.user_message.length > 20_000) {
    throw new BadRequestException({ code: "CHAT_MESSAGE_INVALID_INPUT", field: "user_message" });
  }
  for (const key of ["agent_id", "agent_user_id"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || !input[key]!.trim() || input[key]!.length > 200)) {
      throw new BadRequestException({ code: "CHAT_MESSAGE_INVALID_INPUT", field: key });
    }
  }
  const request = Object.freeze({ merchant_id: input.merchant_id, session_id: input.session_id,
    conversation_id: input.conversation_id, user_message: input.user_message,
    agent_id: input.agent_id, agent_user_id: input.agent_user_id, message_id: input.message_id });
  return { request, requestHash: createHash("sha256").update(JSON.stringify([
    "checkout-chat-request-v1", request.merchant_id, request.session_id, request.conversation_id,
    request.user_message, request.agent_id ?? null, request.agent_user_id ?? null,
  ])).digest("hex") };
}
