import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

export type ConversationNavigationGuard = (proceed: () => void) => boolean;
export interface ConversationNavigation {
  register: (guard: ConversationNavigationGuard | null) => void;
  request: (hash: string, commit: () => void) => void;
  reset: () => void;
}
const positionKey = "__zyonConversationPositionV1";
interface Position { version: 1; nonce: string; index: number }
interface Entry { hash: string; position: Position; length: number; nativeIndex: number | null }
interface Pending {
  from: Entry; toHash: string; delta: number; restored: boolean; approved: boolean; epoch: number;
}
function nativeIndex(): number | null {
  const index = (window as Window & { navigation?: { currentEntry?: { index?: number } } }).navigation?.currentEntry?.index;
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? index : null;
}
function readPosition(): Position | null {
  const value = window.history.state?.[positionKey] as Position | undefined;
  return value?.version === 1 && typeof value.nonce === "string" && Number.isSafeInteger(value.index) ? value : null;
}
function stamp(position: Position) {
  // The app's existing state fields are retained. No draft, user or tenant is stored.
  window.history.replaceState({ ...window.history.state, [positionKey]: position }, "");
}
function entry(position: Position): Entry {
  return { hash: window.location.hash, position, length: window.history.length, nativeIndex: nativeIndex() };
}

/** Mounted from App before route hosts. This observes history; it never patches
 * pushState/replaceState, installs another router or authorizes a server action. */
export function useConversationNavigation(epoch: number): ConversationNavigation {
  const guard = useRef<ConversationNavigationGuard | null>(null);
  const current = useRef<Entry | null>(null);
  const pending = useRef<Pending | null>(null);
  const bypass = useRef<{ hash: string; epoch: number; position?: Position } | null>(null);
  const liveEpoch = useRef(epoch), version = useRef(0);
  if (liveEpoch.current !== epoch) {
    liveEpoch.current = epoch; version.current++; guard.current = null; pending.current = null; bypass.current = null;
  }
  const active = useRef(false);
  const rebase = useCallback(() => {
    const position = readPosition() ?? { version: 1 as const, nonce: Date.now().toString(36) + Math.random().toString(36).slice(2), index: 0 };
    stamp(position); current.current = entry(position);
  }, []);
  const reset = useCallback(() => {
    version.current++; guard.current = null; pending.current = null; bypass.current = null; rebase();
  }, [rebase]);
  const register = useCallback((value: ConversationNavigationGuard | null) => { guard.current = value; }, []);
  const request = useCallback((hash: string, commit: () => void) => {
    const originEpoch = liveEpoch.current, originVersion = ++version.current;
    const proceed = () => {
      if (!active.current || originEpoch !== liveEpoch.current || originVersion !== version.current) return;
      if (hash !== window.location.hash) bypass.current = { hash, epoch: originEpoch };
      commit();
    };
    if (!guard.current?.(proceed)) proceed();
  }, []);

  useLayoutEffect(() => {
    active.current = true;
    rebase();
    const changed = (event: HashChangeEvent) => {
      const from = current.current!;
      const hash = window.location.hash;
      const marked = readPosition();
      const known = marked?.nonce === from.position.nonce ? marked : null;
      const native = nativeIndex();
      const delta = known ? known.index - from.position.index
        : native !== null && from.nativeIndex !== null ? native - from.nativeIndex
        : window.history.length > from.length ? 1 : null;
      const position: Position = known ?? { ...from.position, index: from.position.index + (delta ?? 0) };
      const accepted = bypass.current;
      if (accepted?.hash === hash && accepted.epoch === liveEpoch.current) {
        bypass.current = null; pending.current = null; stamp(accepted.position ?? position); current.current = entry(accepted.position ?? position); return;
      }
      const waiting = pending.current;
      if (waiting) {
        event.stopImmediatePropagation();
        if (waiting.epoch !== liveEpoch.current) { pending.current = null; return; }
        if (hash === waiting.from.hash && known?.index === waiting.from.position.index) {
          waiting.restored = true; pending.current = null; current.current = entry(waiting.from.position);
          if (waiting.approved) {
            bypass.current = { hash: waiting.toHash, epoch: waiting.epoch };
            window.history.go(waiting.delta);
          }
        }
        return;
      }
      if (hash === from.hash) { current.current = entry(position); return; }
      const originEpoch = liveEpoch.current, originVersion = ++version.current;
      if (delta !== null && delta !== 0) {
        const transition: Pending = { from, toHash: hash, delta, restored: false, approved: false, epoch: originEpoch };
        const proceed = () => {
          if (!active.current || originEpoch !== liveEpoch.current || originVersion !== version.current) return;
          transition.approved = true;
          if (transition.restored) {
            bypass.current = { hash, epoch: originEpoch }; window.history.go(delta);
          }
        };
        if (guard.current?.(proceed)) {
          stamp(position); pending.current = transition; event.stopImmediatePropagation();
          window.history.go(-delta); return;
        }
      } else if (guard.current) {
        // Legacy unmarked entry, no browser index: retain the mounted composer
        // and all history entries. Do not guess a traversal direction or replace
        // a legacy URL. Explicit discard publishes exactly this destination.
        const proceed = () => {
          if (!active.current || originEpoch !== liveEpoch.current || originVersion !== version.current || window.location.hash !== hash) return;
          bypass.current = { hash, epoch: originEpoch, position: { version: 1, nonce: from.position.nonce + "-legacy-" + originVersion, index: 0 } };
          window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: event.oldURL, newURL: event.newURL }));
        };
        if (guard.current(proceed)) { event.stopImmediatePropagation(); return; }
      }
      const next = delta === null ? { version: 1 as const, nonce: from.position.nonce + "-legacy-" + originVersion, index: 0 } : position;
      stamp(next); current.current = entry(next);
    };
    window.addEventListener("hashchange", changed, true);
    return () => {
      active.current = false; guard.current = null; pending.current = null; bypass.current = null;
      window.removeEventListener("hashchange", changed, true);
    };
  }, [rebase]);
  // An epoch change invalidates continuations during render, then records the
  // physical entry at commit without clearing a newly registered child guard.
  useLayoutEffect(() => { rebase(); }, [epoch, rebase]);
  return useMemo(() => ({ register, request, reset }), [register, request, reset]);
}
