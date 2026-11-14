import type { ConversationStart, ScopedConversationSession } from './scoped-conversation.js';

/** Access is validated before dispatch; this function never sends a buyer turn. */
export async function prepareConversationTurn(options: {
  owner: ScopedConversationSession;
  hint?: string | null;
  hasBuyerHistory: boolean;
  hasVoiceProof: boolean;
  isCurrent: () => boolean;
  ensureAccess: (id: string) => Promise<void>;
  isExpired: (error: unknown) => boolean;
}): Promise<ConversationStart | null> {
  if (!options.isCurrent()) return null;
  let started = await options.owner.ensure(options.hint);
  if (!options.isCurrent() || !options.owner.current(started.conversation_id)) return null;
  try {
    await options.ensureAccess(started.conversation_id);
  } catch (error) {
    if (!options.isCurrent()) return null;
    if (!options.isExpired(error) || options.hasBuyerHistory || options.hasVoiceProof) throw error;
    started = await options.owner.restart(started.conversation_id);
    if (!options.isCurrent() || !options.owner.current(started.conversation_id)) return null;
    await options.ensureAccess(started.conversation_id);
  }
  return options.isCurrent() && options.owner.current(started.conversation_id) ? started : null;
}
