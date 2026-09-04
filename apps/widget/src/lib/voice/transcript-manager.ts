// Transcript manager — REQ-VC-004 / REQ-VC-006.
//
// Owns the buyer/agent message log of the current voice conversation. Provides:
//   - append (typed by role)
//   - cap to maxSize (FIFO eviction so memory stays bounded)
//   - turn-taking helpers (last by role, getTurns)
//   - export/import for switching between voice/text mid-conversation (REQ-VC-005)
//   - subscribe for UI bindings (Transcript aria-live region, REQ-VC-006)

export type TranscriptRole = "buyer" | "agent";

export type TranscriptMessage = {
  id: string;
  role: TranscriptRole;
  text: string;
  timestamp: number;
};

export type TranscriptSnapshot = {
  messages: TranscriptMessage[];
};

export type TranscriptManagerOptions = {
  maxSize?: number;
  initial?: TranscriptMessage[];
};

export type TranscriptManager = {
  add: (msg: { role: TranscriptRole; text: string }) => string;
  getMessages: () => TranscriptMessage[];
  getTurns: () => TranscriptMessage[];
  getLastByRole: (role: TranscriptRole) => TranscriptMessage | null;
  size: () => number;
  clear: () => void;
  subscribe: (listener: (msg: TranscriptMessage) => void) => () => void;
  export: () => TranscriptSnapshot;
  import: (snapshot: TranscriptSnapshot) => void;
};

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function createTranscriptManager(
  options: TranscriptManagerOptions = {},
): TranscriptManager {
  const maxSize = options.maxSize ?? 200;
  const messages: TranscriptMessage[] = options.initial ? [...options.initial] : [];
  const listeners = new Set<(msg: TranscriptMessage) => void>();

  return {
    add(msg): string {
      const id = createId();
      const entry: TranscriptMessage = {
        id,
        role: msg.role,
        text: msg.text,
        timestamp: Date.now(),
      };
      messages.push(entry);
      if (messages.length > maxSize) {
        messages.splice(0, messages.length - maxSize);
      }
      for (const listener of listeners) listener(entry);
      return id;
    },

    getMessages(): TranscriptMessage[] {
      return messages.slice();
    },

    getTurns(): TranscriptMessage[] {
      return messages.slice();
    },

    getLastByRole(role: TranscriptRole): TranscriptMessage | null {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]!.role === role) return messages[i]!;
      }
      return null;
    },

    size(): number {
      return messages.length;
    },

    clear(): void {
      messages.length = 0;
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    export(): TranscriptSnapshot {
      return { messages: messages.slice() };
    },

    import(snapshot: TranscriptSnapshot): void {
      messages.length = 0;
      for (const m of snapshot.messages) {
        messages.push({ ...m });
      }
      if (messages.length > maxSize) {
        messages.splice(0, messages.length - maxSize);
      }
    },
  };
}