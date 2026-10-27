import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import type { AsaasWalletReturnActor } from "../infrastructure/repositories/prisma-asaas-marketplace-wallet-return.repository.js";

type Kind = "initial" | "residual";
export interface WalletReturnDashboardJournal {
  id: string; refund_id: string; payout_id: string; amount_cents: number; currency: "BRL";
  request_hash: string; status: "claimed" | "unknown" | "pending" | "returned" | "failed";
  can_execute: boolean; certificate_hash: string | null;
}
export interface WalletReturnDashboardEntry {
  refund_id: string; payout_id: string; return_id: string; created_at: string; host_name: string;
  amount_cents: number; currency: "BRL"; environment: "test" | "live"; payment_method: "pix" | "card";
  journal: WalletReturnDashboardJournal | null;
}
export type WalletReturnDashboardPreview = WalletReturnDashboardJournal | {
  refund_id: string; payout_id: string; amount_cents: number; currency: "BRL";
  status: "awaiting_consent"; can_execute: boolean;
};
export interface WalletReturnDashboardSource {
  list(actor: AsaasWalletReturnActor, limit?: number, cursor?: string): Promise<{entries: WalletReturnDashboardEntry[]; next_cursor: string | null}>;
  preview(actor: AsaasWalletReturnActor, refundId: string, sourceId: string): Promise<WalletReturnDashboardPreview>;
  approve(actor: AsaasWalletReturnActor, refundId: string, sourceId: string, amountCents: number): Promise<WalletReturnDashboardJournal>;
  execute(actor: AsaasWalletReturnActor, journalId: string, amountCents: number, requestHash: string): Promise<WalletReturnDashboardJournal>;
  observe(actor: AsaasWalletReturnActor, journalId: string): Promise<WalletReturnDashboardJournal>;
}
type Cursor = {version: 2; scope: string; kind: Kind; cursor: string | null};
const prefix = "aawrpage2_";
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const cursorValue = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,1000}$/.test(value);
const scope = (actor: AsaasWalletReturnActor) => createHash("sha256")
  .update(JSON.stringify([actor.sellerMerchantId, actor.userId])).digest("hex");

/** Keeps original and residual wallet returns on the existing authenticated
 * dashboard. Queues are paged sequentially; this does not claim global ordering.
 * Reading a page or routing a command cannot authorize a financial submission. */
@Injectable()
export class MarketplaceAsaasWalletReturnDashboardService {
  constructor(private readonly initial: WalletReturnDashboardSource,
    private readonly residual: WalletReturnDashboardSource,
    private readonly resolveSource: (actor: AsaasWalletReturnActor, refundId: string, sourceId: string) => Promise<Kind | null>,
    private readonly tenant?: TenantContextService) {}

  async list(actor: AsaasWalletReturnActor, limit = 20, encodedCursor?: string) {
    this.guard(actor);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) this.invalidPage();
    const cursor = this.decode(actor, encodedCursor);
    if (cursor.kind === "residual") {
      const page = await this.residual.list(actor, limit, cursor.cursor ?? undefined);
      this.page(page, limit);
      return {entries: page.entries, next_cursor: page.next_cursor === null ? null : this.encode(actor, "residual", page.next_cursor)};
    }
    const initial = await this.initial.list(actor, limit, cursor.cursor ?? undefined);
    this.page(initial, limit);
    if (initial.next_cursor !== null) return {entries: initial.entries, next_cursor: this.encode(actor, "initial", initial.next_cursor)};
    if (initial.entries.length === limit) return {entries: initial.entries, next_cursor: this.encode(actor, "residual", null)};
    const residual = await this.residual.list(actor, limit - initial.entries.length);
    this.page(residual, limit - initial.entries.length);
    const entries = [...initial.entries, ...residual.entries];
    this.distinct(entries);
    return {entries, next_cursor: residual.next_cursor === null ? null : this.encode(actor, "residual", residual.next_cursor)};
  }

  async preview(actor: AsaasWalletReturnActor, refundId: string, sourceId: string) {
    return (await this.source(actor, refundId, sourceId)).preview(actor, refundId, sourceId);
  }
  async approve(actor: AsaasWalletReturnActor, refundId: string, sourceId: string, amountCents: number) {
    return (await this.source(actor, refundId, sourceId)).approve(actor, refundId, sourceId, amountCents);
  }
  execute(actor: AsaasWalletReturnActor, journalId: string, amountCents: number, requestHash: string) {
    return this.journalSource(actor, journalId).execute(actor, journalId, amountCents, requestHash);
  }
  observe(actor: AsaasWalletReturnActor, journalId: string) {
    return this.journalSource(actor, journalId).observe(actor, journalId);
  }

  private guard(actor: AsaasWalletReturnActor) {
    if (!actor || !id(actor.sellerMerchantId) || !id(actor.userId)) throw new ForbiddenException("marketplace_wallet_return_forbidden");
    const active = this.tenant?.get();
    if (active && (active.merchantId !== actor.sellerMerchantId || active.userId !== actor.userId ||
      !["owner", "admin"].includes(active.role))) throw new ForbiddenException("marketplace_wallet_return_forbidden");
  }
  private async source(actor: AsaasWalletReturnActor, refundId: string, sourceId: string) {
    this.guard(actor);
    if (!id(refundId) || !id(sourceId)) this.invalidPage();
    const kind = await this.resolveSource(actor, refundId, sourceId);
    if (kind === null) throw new NotFoundException("marketplace_wallet_return_not_found");
    if (kind !== "initial" && kind !== "residual") throw new ConflictException("marketplace_wallet_return_unavailable");
    return kind === "initial" ? this.initial : this.residual;
  }
  private journalSource(actor: AsaasWalletReturnActor, journalId: string) {
    this.guard(actor);
    if (!id(journalId)) this.invalidPage();
    if (journalId.startsWith("awresreturn_")) {
      if (!/^awresreturn_[a-f0-9]{64}$/.test(journalId)) this.invalidPage();
      return this.residual;
    }
    return this.initial;
  }
  private decode(actor: AsaasWalletReturnActor, encoded?: string): Cursor {
    if (encoded === undefined) return {version: 2, scope: scope(actor), kind: "initial", cursor: null};
    if (!cursorValue(encoded)) this.invalidPage();
    // Old bookmarks continue the original queue; they do not acquire a new
    // residual cursor or bypass that repository's own seller-bound decoding.
    if (!encoded.startsWith(prefix)) return {version: 2, scope: scope(actor), kind: "initial", cursor: encoded};
    try {
      const decoded: unknown = JSON.parse(Buffer.from(encoded.slice(prefix.length), "base64url").toString("utf8"));
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) this.invalidPage();
      const row = decoded as Cursor;
      if (Object.keys(row).sort().join(",") !== "cursor,kind,scope,version" || row.version !== 2 || row.scope !== scope(actor) ||
        !["initial", "residual"].includes(row.kind) || row.cursor !== null && !cursorValue(row.cursor)) this.invalidPage();
      if (this.encode(actor, row.kind, row.cursor) !== encoded) this.invalidPage();
      return row;
    } catch { return this.invalidPage(); }
  }
  private encode(actor: AsaasWalletReturnActor, kind: Kind, cursor: string | null): string {
    const encoded = prefix + Buffer.from(JSON.stringify({version: 2, scope: scope(actor), kind, cursor} satisfies Cursor)).toString("base64url");
    if (!cursorValue(encoded)) throw new ConflictException("marketplace_wallet_return_page_unavailable");
    return encoded;
  }
  private page(page: {entries: WalletReturnDashboardEntry[]; next_cursor: string | null}, limit: number) {
    if (!page || !Array.isArray(page.entries) || page.entries.length > limit ||
      page.next_cursor !== null && !cursorValue(page.next_cursor)) throw new ConflictException("marketplace_wallet_return_page_unavailable");
    this.distinct(page.entries);
  }
  private distinct(entries: WalletReturnDashboardEntry[]) {
    if (entries.some(row => !row || !id(row.refund_id) || !id(row.payout_id)) ||
      new Set(entries.map(row => `${row.refund_id}:${row.payout_id}`)).size !== entries.length) throw new ConflictException("marketplace_wallet_return_page_unavailable");
  }
  private invalidPage(): never { throw new BadRequestException("invalid_marketplace_wallet_return_page"); }
}
