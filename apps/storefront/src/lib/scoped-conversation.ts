export interface ConversationStart {
  conversation_id: string;
  merchant_id?: string;
  experiment?: any;
  [key: string]: unknown;
}

export class ScopedConversationUnavailable extends Error {
  constructor(readonly code: string) { super(code); }
}

interface ConversationDependencies {
  create: () => Promise<ConversationStart>;
  isCurrent: () => boolean;
  hasAccess: (id: string) => boolean;
  protectedCart: () => string | null;
  isReadOnly: () => boolean;
  save: (id: string) => void;
  clear: (id: string) => void;
  isRetired: (id: string) => boolean;
}

/** Identity continuity is a local hint. Each request still needs its signed API capability. */
export class ScopedConversationSession {
  private result: ConversationStart | null;
  private pending: Promise<ConversationStart> | null = null;
  private disposed = false;

  constructor(readonly merchantId: string, private readonly deps: ConversationDependencies, hint: string | null = null) {
    this.result = hint && !deps.isRetired(hint) ? { conversation_id: hint } : null;
  }

  get id() { return this.result?.conversation_id ?? null; }
  current(id?: string | null): boolean {
    return !this.disposed && this.deps.isCurrent() && (!id || this.id === id);
  }
  dispose(): void { this.disposed = true; }

  adoptHint(id: string): boolean {
    if (!this.current() || !id || this.deps.isRetired(id) || !this.deps.hasAccess(id)) return false;
    if ((this.id && this.id !== id) || (this.deps.protectedCart() && this.deps.protectedCart() !== id) || this.pending) return this.id === id;
    this.result ??= { conversation_id: id };
    this.deps.save(id);
    return true;
  }

  async ensure(hint?: string | null): Promise<ConversationStart> {
    if (!this.current()) throw new ScopedConversationUnavailable("conversation_context_changed");
    const protectedId = this.deps.protectedCart();
    if (hint && ((this.id && this.id !== hint) || (protectedId && protectedId !== hint))) {
      throw new ScopedConversationUnavailable("conversation_cart_mismatch");
    }
    if (hint && !this.id && !this.adoptHint(hint)) throw new ScopedConversationUnavailable("conversation_access_required");
    if (this.deps.isReadOnly()) throw new ScopedConversationUnavailable("conversation_recovery_required");
    if (protectedId && this.id !== protectedId) {
      if (!this.adoptHint(protectedId)) throw new ScopedConversationUnavailable("conversation_access_required");
    }
    if (this.result) {
      if (!this.deps.hasAccess(this.result.conversation_id)) throw new ScopedConversationUnavailable("conversation_access_required");
      return this.result;
    }
    if (this.pending) return this.pending;
    const pending = (async () => {
      const created = await this.deps.create();
      if (!this.current()) throw new ScopedConversationUnavailable("conversation_context_changed");
      if (!created || typeof created.conversation_id !== "string" || !created.conversation_id
        || (created.merchant_id !== undefined && created.merchant_id !== this.merchantId)
        || !this.deps.hasAccess(created.conversation_id)) throw new ScopedConversationUnavailable("conversation_access_required");
      if (this.deps.protectedCart() && this.deps.protectedCart() !== created.conversation_id) {
        throw new ScopedConversationUnavailable("conversation_cart_mismatch");
      }
      this.result = created;
      this.deps.save(created.conversation_id);
      return created;
    })();
    this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = null; }
  }

  async restart(expectedId: string): Promise<ConversationStart> {
    if (!this.current(expectedId)) throw new ScopedConversationUnavailable("conversation_context_changed");
    if (this.deps.protectedCart() || this.deps.isReadOnly()) throw new ScopedConversationUnavailable("conversation_recovery_required");
    if (this.pending) return this.pending;
    const previous = this.result;
    this.deps.clear(expectedId);
    this.result = null;
    try { return await this.ensure(); }
    catch (error) {
      if (this.current() && !this.result && previous) {
        this.result = previous;
        this.deps.save(previous.conversation_id);
      }
      throw error;
    }
  }
}
