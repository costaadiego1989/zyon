/**
 * Context Injection — injects merchant config document into LangGraph agent context.
 *
 * The config document is placed as the FIRST system message, ensuring:
 * - It is NEVER trimmed by the context window (system messages are retained first).
 * - It is refreshed on each session start.
 * - The agent always has merchant configuration available.
 */

import type { ContextMessage } from "../langgraph/context-manager.js";

/**
 * Inject merchant config document as the first system message.
 *
 * @param configDocument - The compiled merchant config markdown document
 * @param existingMessages - Previous conversation messages
 * @returns Messages with config injected as the first system message
 */
export function injectConfigDocument(
  configDocument: string | null | undefined,
  existingMessages: ContextMessage[]
): ContextMessage[] {
  if (!configDocument || configDocument.length === 0) {
    return existingMessages;
  }

  // Separate system and non-system messages.
  const systemMessages = existingMessages.filter((m) => m.role === "system");
  const nonSystemMessages = existingMessages.filter((m) => m.role !== "system");

  // Create config message as the first system message.
  const configMessage: ContextMessage = {
    role: "system",
    content: configDocument
  };

  // Return: config doc first, then other system messages, then non-system messages.
  return [configMessage, ...systemMessages, ...nonSystemMessages];
}
