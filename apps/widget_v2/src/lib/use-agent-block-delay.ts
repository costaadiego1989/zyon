import { useEffect, useMemo, useReducer, useRef } from "react";

export const AGENT_BLOCK_DELAY_MS = 1_500;

type ConversationMessage = { id: string; role: string; text?: string };

/** Delay new reply controls, not the reply itself or already restored history. */
export function useAgentBlockDelay(
  messages: readonly ConversationMessage[],
  scopeKey: string | null,
): ReadonlySet<string> {
  const [revision, refresh] = useReducer((revision: number) => revision + 1, 0);
  const timeline = useRef({
    scopeKey,
    deadlines: new Map(messages.map((message) => [message.id, 0])),
  });

  // Unseen replies are withheld on their very first render, before the effect
  // records their deadline. Hidden components are not mounted or focusable.
  const pending = new Set<string>();
  if (timeline.current.scopeKey === scopeKey) {
    const now = Date.now();
    for (const message of messages) {
      if (message.role !== "agent" || !message.text?.trim()) continue;
      const deadline = timeline.current.deadlines.get(message.id);
      if (deadline === undefined || deadline > now) pending.add(message.id);
    }
  }
  // Keep the same identity across unrelated composer/voice rerenders so scroll
  // effects only run when a component actually appears or disappears.
  const pendingKey = JSON.stringify([...pending]);
  const pendingIds = useMemo(() => new Set<string>(JSON.parse(pendingKey)), [pendingKey]);

  useEffect(() => {
    const now = Date.now();
    const current = timeline.current;
    if (current.scopeKey !== scopeKey) {
      current.scopeKey = scopeKey;
      current.deadlines = new Map(messages.map((message) => [message.id, 0]));
    }
    const present = new Set(messages.map((message) => message.id));
    for (const id of current.deadlines.keys()) {
      if (!present.has(id)) current.deadlines.delete(id);
    }
    for (const message of messages) {
      if (!current.deadlines.has(message.id)) {
        current.deadlines.set(message.id, message.role === "agent" && message.text?.trim()
          ? now + AGENT_BLOCK_DELAY_MS : 0);
      }
    }
    // A deadline can pass between render and this effect. Still schedule its
    // reveal (at zero delay), instead of leaving that component hidden forever.
    const next = Math.min(...[...pendingIds].map((id) => current.deadlines.get(id) ?? Infinity));
    if (!Number.isFinite(next)) return;
    // Preserve deadlines across updates. Re-rendering or appending another
    // message must not restart an existing reply's reading interval.
    const timer = setTimeout(refresh, Math.max(0, next - now));
    return () => clearTimeout(timer);
  }, [messages, scopeKey, revision, pendingIds]);

  return pendingIds;
}
