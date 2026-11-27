import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { initialStore, MetaAdsError, type MetaAdsRepository, type MetaAdsStoreState, type MetaAdsRecord, type MetaAdsRecordKind, type MetaAdsMutation } from "../domain/types.js";
import { requireIdentifier, stableDigest } from "../domain/offer.js";

function stateOf(value: unknown, merchantId: string): MetaAdsStoreState {
  const state = value as MetaAdsStoreState;
  if (!state || state.schemaVersion !== 1 || state.merchantId !== merchantId) throw new MetaAdsError("tenant_state_invalid", 500);
  return state;
}
function pageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) throw new MetaAdsError("invalid_page_size");
  return value;
}
function recordOf<T>(row: { key: string; kind: string; payload: unknown; createdAt: Date }): MetaAdsRecord<T> {
  return { key: row.key, kind: row.kind as MetaAdsRecordKind, payload: row.payload as T, createdAt: row.createdAt.toISOString() };
}

export class PrismaMetaAdsRepository implements MetaAdsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async read(merchantId: string): Promise<MetaAdsStoreState> {
    requireIdentifier(merchantId);
    const row = await this.prisma.metaAdsAgentStore.findUnique({ where: { merchantId } });
    return row ? stateOf(row.state, merchantId) : initialStore(merchantId);
  }

  async mutate<T>(merchantId: string, readKeys: string[], change: (state: MetaAdsStoreState, existing: ReadonlyMap<string, MetaAdsRecord>) => MetaAdsMutation<T>): Promise<T> {
    return this.transaction(merchantId, readKeys, change);
  }

  async mutateCampaignLifecycle<T>(merchantId: string, campaignId: string, readKeys: string[], change: (state: MetaAdsStoreState, existing: ReadonlyMap<string, MetaAdsRecord>, preparations: Array<{id: string; status: string}>) => MetaAdsMutation<T> & {invalidatePreparations?: boolean}): Promise<T> {
    requireIdentifier(campaignId);
    return this.transaction(merchantId, readKeys, change, campaignId);
  }

  private async transaction<T>(merchantId: string, readKeys: string[], change: (state: MetaAdsStoreState, existing: ReadonlyMap<string, MetaAdsRecord>, preparations: Array<{id: string; status: string}>) => MetaAdsMutation<T> & {invalidatePreparations?: boolean}, campaignId?: string): Promise<T> {
    requireIdentifier(merchantId);
    return this.prisma.$transaction(async tx => {
      // The insert also serializes the first concurrent mutations of a new store.
      await tx.$executeRaw`INSERT INTO meta_ads_agent_stores(merchant_id,state,updated_at) VALUES(${merchantId},${JSON.stringify(initialStore(merchantId))}::jsonb,now()) ON CONFLICT(merchant_id) DO NOTHING`;
      const [row] = await tx.$queryRaw<Array<{ state: unknown }>>`SELECT state FROM meta_ads_agent_stores WHERE merchant_id=${merchantId} FOR UPDATE`;
      const state = stateOf(row?.state, merchantId);
      const preparations = campaignId ? await tx.$queryRaw<Array<{id: string; status: string}>>`SELECT id,status FROM meta_ads_campaign_preparations WHERE merchant_id=${merchantId} AND campaign_id=${campaignId} ORDER BY id FOR UPDATE` : [];
      const rows = readKeys.length ? await tx.metaAdsAgentRecord.findMany({ where: { merchantId, key: { in: readKeys } } }) : [];
      // Synchronous callback only: network effects must happen after this commit.
      const mutation = change(state, new Map(rows.map(record => [record.key, recordOf(record)])), preparations);
      if (!mutation || typeof (mutation as unknown as Promise<unknown>).then === "function") throw new MetaAdsError("async_mutation_forbidden", 500);
      stateOf(state, merchantId);
      stableDigest(state);
      await tx.metaAdsAgentStore.update({ where: { merchantId }, data: { state: state as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      if (campaignId && mutation.invalidatePreparations) await tx.metaAdsCampaignPreparation.updateMany({where: {merchantId, campaignId, status: {in: ['queued','blocked','review_ready']}}, data: {status: 'superseded', fence: {increment: 1}, leaseToken: null, leaseUntil: null}});
      for (const record of mutation.records ?? []) {
        if (!record.key || record.key.length > 512 || /[\x00-\x1f]/.test(record.key)) throw new MetaAdsError("invalid_record_key");
        stableDigest(record.payload);
        await tx.metaAdsAgentRecord.create({ data: { id: randomUUID(), merchantId, key: record.key, kind: record.kind, payload: record.payload as Prisma.InputJsonValue, createdAt: new Date(record.createdAt) } });
      }
      return mutation.result;
    }, { maxWait: 20000, timeout: 20000 });
  }

  async getRecord<T = unknown>(merchantId: string, key: string): Promise<MetaAdsRecord<T> | null> {
    requireIdentifier(merchantId);
    const row = await this.prisma.metaAdsAgentRecord.findUnique({ where: { merchantId_key: { merchantId, key } } });
    return row ? recordOf<T>(row) : null;
  }

  async listRecords<T = unknown>(merchantId: string, kind: MetaAdsRecordKind, limit = 100, before?: string): Promise<MetaAdsRecord<T>[]> {
    requireIdentifier(merchantId);
    const rows = await this.prisma.metaAdsAgentRecord.findMany({ where: { merchantId, kind, ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize(limit) });
    return rows.map(row => recordOf<T>(row));
  }

  async listStoreIds(limit: number, after?: string): Promise<string[]> {
    const rows = await this.prisma.metaAdsAgentStore.findMany({ where: after ? { merchantId: { gt: after } } : {}, orderBy: { merchantId: "asc" }, take: pageSize(limit), select: { merchantId: true } });
    return rows.map(row => row.merchantId);
  }

  async listPendingGenerations(limit: number): Promise<Array<{ merchantId: string; generationId: string }>> {
    return this.prisma.$queryRaw`SELECT s.merchant_id AS "merchantId", g.key AS "generationId" FROM meta_ads_agent_stores s CROSS JOIN LATERAL jsonb_each(s.state->'generations') g WHERE g.value->>'status'='reserved' ORDER BY s.updated_at, s.merchant_id, g.key LIMIT ${pageSize(limit)}`;
  }
}
