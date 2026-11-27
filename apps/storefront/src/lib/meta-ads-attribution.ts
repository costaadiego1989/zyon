interface ClientOptions {
  merchantId: string; storeKey: string; pixelId?: string; consentVersion: string;
  consent(): boolean; sourceUrl(): string; cookies(): string; now(): number;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  send(conversationId: string, action: "attribution" | "bind" | "purchase" | "revoke", body: Record<string, unknown>,metadata?:{idempotencyKey:string}): Promise<unknown>;
  pixel(...args: unknown[]): void;
}
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const validCookie = (value: string | undefined) => value && /^fb\.\d\.\d{10,16}\.[A-Za-z0-9._-]{1,500}$/.test(value) ? value : undefined;
export class MetaAdsAttributionClient {
  private readonly known = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly events = new Set<string>();
  private readonly done = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly captures = new Map<string, Promise<void>>();
  private readonly origins = new Set<string>();
  private readonly legacyTokens = new Map<string,string>();
  private token: string | null = null;
  private epoch = 0;
  private readonly key: string;
  constructor(private readonly options: ClientOptions) {
    this.key = `zyon-meta-ads:${options.storeKey}`;
    try {
      const raw = JSON.parse(options.storage.getItem(this.key) ?? "null");
      if (raw && Array.isArray(raw.conversations) && Array.isArray(raw.pending) && Array.isArray(raw.events)) {
        for (const id of raw.conversations.filter(identifier)) this.known.add(id);
        for (const id of raw.pending.filter(identifier)) this.pending.add(id);
        if (options.consent()) {
          this.token = typeof raw.token === "string" && raw.token.length <= 300 ? raw.token : null;
          if(Array.isArray(raw.origins))for(const key of raw.origins.filter(identifier).slice(-1000))this.origins.add(key);
          else if(this.token)for(const id of this.known)this.legacyTokens.set(id,this.token);
          for (const id of raw.events.filter(identifier).slice(-1000)) this.events.add(id);
        } else { for (const id of this.known) this.pending.add(id); this.known.clear(); }
      }
    } catch { /* Unavailable tab storage never blocks shopping. */ }
  }
  private persist(): void {
    try {
      if (!this.known.size && !this.pending.size && !this.events.size && !this.token) this.options.storage.removeItem(this.key);
      else this.options.storage.setItem(this.key, JSON.stringify({ token: this.token, conversations: [...this.known], pending: [...this.pending], events: [...this.events].slice(-1000),origins:[...this.origins].slice(-1000) }));
    } catch { /* Keep consent withdrawal pending in memory when storage is unavailable. */ }
  }
  pendingRevocations(): number { return this.pending.size; }
  async capture(conversationId: string): Promise<void> {
    if (!identifier(conversationId) || !this.options.consent()) return;
    if (this.pending.size) { await this.retryRevocations(); if (this.pending.size) return; }
    let url: URL; try { url = new URL(this.options.sourceUrl()); } catch { return; }
    const token = url.searchParams.get("zyon_ad");
    if (!token || token.length > 300 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return;
    if(this.legacyTokens.get(conversationId)===token)return;
    const click=url.searchParams.get('fbclid');
    if(click&& !/^[A-Za-z0-9_-]{1,500}$/.test(click))return;
    const epoch=this.epoch;
    const fingerprint=JSON.stringify([conversationId,token,click]);
    const existing=this.captures.get(fingerprint);if(existing)return existing;
    const operation=(async()=>{
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint));
      const key=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
      if(!this.options.consent()||epoch!==this.epoch||this.origins.has(key))return;
      return this.captureOnce(conversationId,token,click,key);
    })().catch(()=>undefined).finally(()=>{this.captures.delete(fingerprint);});
    this.captures.set(fingerprint,operation);return operation;
  }
  private async captureOnce(conversationId: string,token:string,click:string|null,key:string): Promise<void> {
    const cookies = new Map(this.options.cookies().split(";").map(value => { const index = value.indexOf("="); return [value.slice(0, index).trim(), value.slice(index + 1)] as const; }));
    const previous = validCookie(cookies.get("_fbc"));
    const fbc = click && /^[A-Za-z0-9_-]{1,500}$/.test(click) ? previous?.endsWith(`.${click}`) ? previous : `fb.1.${this.options.now()}.${click}` : previous;
    const fbp = validCookie(cookies.get("_fbp")); const epoch = this.epoch;
    const response = await this.options.send(conversationId, "attribution", { token, consent: true, consentVersion: this.options.consentVersion, ...(fbc ? { fbc } : {}), ...(fbp ? { fbp } : {}) },{idempotencyKey:key}) as { receiptId?: unknown } | null;
    if (typeof response?.receiptId !== "string") return;
    if (!this.options.consent() || epoch !== this.epoch) { this.pending.add(conversationId); this.persist(); await this.retryRevocations(); return; }
    this.known.add(conversationId); this.origins.add(key);this.legacyTokens.delete(conversationId);this.token = token; this.persist();
  }
  async purchase(detail: unknown): Promise<void> {
    if (!this.options.consent() || this.pending.size || !detail || typeof detail !== "object") return;
    const hint = detail as Record<string, unknown>;
    if (hint.merchantId !== this.options.merchantId || !identifier(hint.cartRef) || !this.known.has(hint.cartRef) || !identifier(hint.sessionId) || typeof hint.orderId !== "string" || !hint.orderId.trim() || hint.orderId.length > 200) return;
    const key = JSON.stringify([hint.cartRef, hint.sessionId, hint.orderId]); if (this.done.has(key)) return;
    const existing = this.inFlight.get(key); if (existing) return existing;
    const operation = this.verifyPurchase(hint.cartRef, hint.sessionId, hint.orderId, key).catch(() => undefined).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, operation); return operation;
  }
  private async verifyPurchase(conversationId: string, checkoutSessionId: string, orderId: string, key: string): Promise<void> {
    const epoch = this.epoch;
    const response = await this.options.send(conversationId, "purchase", { checkoutSessionId, orderId }) as { eventId?: unknown; valueCents?: unknown; currency?: unknown; pixelId?: unknown } | null;
    if (!response || !identifier(response.eventId) || !Number.isSafeInteger(response.valueCents) || (response.valueCents as number) <= 0 || typeof response.currency !== "string" || !/^[A-Z]{3}$/.test(response.currency)) return;
    this.done.add(key);
    if (!this.options.consent() || this.pending.size || epoch !== this.epoch || this.events.has(response.eventId) || response.pixelId !== this.options.pixelId || !/^\d{10,20}$/.test(this.options.pixelId ?? "")) return;
    this.options.pixel("trackSingle", this.options.pixelId, "Purchase", { value: (response.valueCents as number) / 100, currency: response.currency }, { eventID: response.eventId });
    this.events.add(response.eventId); this.persist();
  }
  async revoke(): Promise<void> {
    this.epoch++; for (const id of this.known) this.pending.add(id);
    this.known.clear(); this.events.clear(); this.done.clear();this.origins.clear();this.legacyTokens.clear(); this.token = null; this.persist(); await this.retryRevocations();
  }
  private async retryRevocations(): Promise<void> {
    await Promise.all([...this.pending].map(async conversationId => {
      try { const result = await this.options.send(conversationId, "revoke", {}) as { revoked?: unknown } | null; if (result?.revoked === true) this.pending.delete(conversationId); } catch { /* Retry until the server acknowledges withdrawal. */ }
    })); this.persist();
  }
}
