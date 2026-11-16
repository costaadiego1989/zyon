import type { MetaAdsDailyReport } from '@zyon/shared-types';
import type { ClosedObservationDay } from './daily-observation-calendar.js';

export type DailyAnalysisStatus = 'pending' | 'sending' | MetaAdsDailyReport['analysisStatus'];
export interface DailyRun extends ClosedObservationDay {
  id: string; merchantId: string; accountId: string; status: 'queued' | 'running' | 'partial' | 'completed';
  analysisStatus: DailyAnalysisStatus; fence: number; leaseToken: string | null; leaseUntil: string | null;
  nextAttemptAt: string; progress: Record<string, unknown>; report: MetaAdsDailyReport | null; createdAt: string; updatedAt: string;
}
export interface DailyLease extends DailyRun { leaseToken: string; leaseUntil: string; }
export interface DailyCheckpoint { progress?: Record<string, unknown>; report?: MetaAdsDailyReport; analysisStatus?: DailyAnalysisStatus; }
export interface DailyObservationRepository {
  admit(identity: ClosedObservationDay & { merchantId: string; accountId: string }): Promise<DailyRun>;
  claim(merchantId: string, id: string): Promise<DailyLease | null>;
  read(merchantId: string, id: string): Promise<DailyRun>;
  list(merchantId: string, accountId: string, limit?: number): Promise<DailyRun[]>;
  latestDay(merchantId: string, accountId: string, timezone: string): Promise<string | null>;
  pending(limit?: number): Promise<DailyRun[]>;
  checkpoint(lease: DailyLease, patch: DailyCheckpoint): Promise<DailyLease>;
  heartbeat(lease: DailyLease): Promise<void>;
  finish(lease: DailyLease, status: 'partial' | 'completed', nextAttemptAt?: Date): Promise<void>;
}
