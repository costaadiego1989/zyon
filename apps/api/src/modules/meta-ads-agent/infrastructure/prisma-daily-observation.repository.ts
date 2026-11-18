import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type MetaAdsDailyRun } from '@prisma/client';
import type { MetaAdsDailyReport } from '@zyon/shared-types';
import { MetaAdsError, type Clock } from '../domain/types.js';
import { requireIdentifier } from '../domain/offer.js';
import { dailyObservationKey, observationPeriod } from '../domain/daily-observation-calendar.js';
import type { DailyRun, DailyLease, DailyCheckpoint, DailyObservationRepository } from '../domain/daily-observation.port.js';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const page = (limit: number) => { if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new MetaAdsError('daily_page_invalid'); return limit; };
function map(row: MetaAdsDailyRun): DailyRun {
  return { ...row, ...observationPeriod(row.localDay, row.timezone), status: row.status as DailyRun['status'], analysisStatus: row.analysisStatus === 'running' ? 'sending' : row.analysisStatus as DailyRun['analysisStatus'],
    leaseUntil: row.leaseUntil?.toISOString() ?? null, nextAttemptAt: row.nextAttemptAt.toISOString(), progress: row.progress as Record<string, unknown>, report: row.report as unknown as MetaAdsDailyReport | null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export class PrismaDailyObservationRepository implements DailyObservationRepository {
  constructor(private readonly db: PrismaClient, private readonly clock: Clock = () => new Date()) {}
  async admit(identity: Parameters<DailyObservationRepository['admit']>[0]): Promise<DailyRun> {
    const id = dailyObservationKey(identity.merchantId, identity.accountId, identity), now = this.clock();
    await this.db.$executeRaw`INSERT INTO meta_ads_daily_runs(id,merchant_id,account_id,local_day,timezone,created_at,updated_at,next_attempt_at)
      VALUES(${id},${identity.merchantId},${identity.accountId},${identity.localDay},${identity.timezone},${now},${now},${now})
      ON CONFLICT DO NOTHING`;
    const run = await this.read(identity.merchantId, id);
    if (run.accountId !== identity.accountId || run.localDay !== identity.localDay || run.timezone !== identity.timezone) throw new MetaAdsError('daily_identity_conflict', 409);
    return run;
  }
  async read(merchantId: string, id: string): Promise<DailyRun> {
    requireIdentifier(merchantId); requireIdentifier(id); const row = await this.db.metaAdsDailyRun.findFirst({ where: { id, merchantId } });
    if (!row) throw new MetaAdsError('daily_report_not_found', 404); return map(row);
  }
  async list(merchantId: string, accountId: string, limit = 31): Promise<DailyRun[]> {
    requireIdentifier(merchantId); requireIdentifier(accountId);
    return (await this.db.metaAdsDailyRun.findMany({ where: { merchantId, accountId }, orderBy: [{ localDay: 'desc' }, { createdAt: 'desc' }], take: page(limit) })).map(map);
  }
  async latestDay(merchantId: string, accountId: string, timezone: string): Promise<string | null> {
    requireIdentifier(merchantId); requireIdentifier(accountId);
    return (await this.db.metaAdsDailyRun.findFirst({ where: { merchantId, accountId, timezone }, orderBy: { localDay: 'desc' }, select: { localDay: true } }))?.localDay ?? null;
  }
  async pending(limit = 50): Promise<DailyRun[]> {
    const now = this.clock(); return (await this.db.metaAdsDailyRun.findMany({ where: { OR: [{ status: { in: ['queued', 'partial'] }, nextAttemptAt: { lte: now } }, { status: 'running', leaseUntil: { lte: now } }] },
      orderBy: [{ localDay: 'asc' }, { createdAt: 'asc' }], take: page(limit) })).map(map);
  }
  async claim(merchantId: string, id: string): Promise<DailyLease | null> {
    requireIdentifier(merchantId); requireIdentifier(id);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM meta_ads_daily_runs WHERE id=${id} AND merchant_id=${merchantId} FOR UPDATE`;
      const row = await tx.metaAdsDailyRun.findFirst({ where: { id, merchantId } }); if (!row) throw new MetaAdsError('daily_report_not_found', 404);
      const now = this.clock();
      if (row.status === 'completed' || row.status === 'running' && row.leaseUntil && row.leaseUntil > now || row.status !== 'running' && row.nextAttemptAt > now) return null;
      const saved = await tx.metaAdsDailyRun.update({ where: { id }, data: { status: 'running', fence: { increment: 1 }, leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + 120000), updatedAt: now } });
      return map(saved) as DailyLease;
    }, { maxWait: 20000, timeout: 20000 });
  }
  private where(lease: DailyLease) {
    return { id: lease.id, merchantId: lease.merchantId, accountId: lease.accountId, timezone: lease.timezone, localDay: lease.localDay, status: 'running', fence: lease.fence, leaseToken: lease.leaseToken, leaseUntil: { gt: this.clock() } };
  }
  async checkpoint(lease: DailyLease, patch: DailyCheckpoint): Promise<DailyLease> {
    return this.db.$transaction(async tx => {
      const result = await tx.metaAdsDailyRun.updateMany({ where: this.where(lease), data: { updatedAt: this.clock(),
        ...(patch.progress === undefined ? {} : { progress: json(patch.progress) }), ...(patch.report === undefined ? {} : { report: json(patch.report) }), ...(patch.analysisStatus === undefined ? {} : { analysisStatus: patch.analysisStatus === 'sending' ? 'running' : patch.analysisStatus }) } });
      if (result.count !== 1) throw new MetaAdsError('daily_lease_lost', 409);
      return map(await tx.metaAdsDailyRun.findUniqueOrThrow({ where: { id: lease.id } })) as DailyLease;
    });
  }
  async heartbeat(lease: DailyLease): Promise<void> {
    const now = this.clock(); const result = await this.db.metaAdsDailyRun.updateMany({ where: this.where(lease), data: { leaseUntil: new Date(now.getTime() + 120000), updatedAt: now } });
    if (result.count !== 1) throw new MetaAdsError('daily_lease_lost', 409);
  }
  async finish(lease: DailyLease, status: 'partial' | 'completed', nextAttemptAt?: Date): Promise<void> {
    const now = this.clock(), next = nextAttemptAt ?? new Date(now.getTime() + (status === 'partial' ? 60000 : 0));
    const result = await this.db.metaAdsDailyRun.updateMany({ where: this.where(lease), data: { status, leaseToken: null, leaseUntil: null, nextAttemptAt: next, updatedAt: now } });
    if (result.count !== 1) throw new MetaAdsError('daily_lease_lost', 409);
  }
}
