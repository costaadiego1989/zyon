import { randomUUID } from 'node:crypto';
import { type AssistantRepository, type AssistantScope } from '../domain/assistant.port.js';
import type { AssistantResponse, AssistantResponseInput } from '../application/assistant.service.js';
import { assertAssistantTurnLease, type TurnAdmissionService } from '../application/turn-admission.service.js';

interface Job { scope: AssistantScope; threadId: string; turnId: string; }
interface Dependencies {
  repo: AssistantRepository; admission: TurnAdmissionService;
  respond: (input: AssistantResponseInput) => Promise<AssistantResponse>;
  clock?: () => Date; id?: () => string; enabled?: boolean;
  accepts?: (scope: AssistantScope) => boolean;
  contexts?: () => string[];
}
/** PostgreSQL owns the queue and fencing. Timers only request a drain. */
export class AssistantWorker {
  private readonly clock: () => Date;
  private readonly id: () => string;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping = false;
  constructor(private readonly deps: Dependencies) { this.clock = deps.clock ?? (() => new Date()); this.id = deps.id ?? randomUUID; }
  onModuleInit(): void {
    if (!this.deps.enabled) return;
    this.timer = setInterval(() => { void this.drain(); }, 3000); this.timer.unref(); void this.drain();
  }
  async onModuleDestroy(): Promise<void> { this.stopping = true; clearInterval(this.timer); await this.active; }
  drain(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return this.active ??= this.process().catch(() => undefined).finally(() => { this.active = undefined; });
  }
  private async process(): Promise<void> {
    for (const job of await this.deps.repo.pending(this.clock(), 20, this.deps.contexts?.())) {
      if (this.stopping) return;
      if (this.deps.accepts && !this.deps.accepts(job.scope)) continue;
      try { await this.run(job); } catch { /* Durable queue/receipts remain for a later owner. */ }
    }
  }
  private async run(job: Job): Promise<void> {
    const token = this.id();
    const claimed = await this.deps.repo.atomic(job.scope, job.threadId, async tx => {
      const turn = await tx.turn(job.turnId);
      if (!turn || !['queued', 'running'].includes(turn.status) || turn.status === 'running' && turn.leaseUntil && Date.parse(turn.leaseUntil) > this.clock().getTime()) return false;
      if (turn.providerRequests.some(attempt => ['sending', 'unknown'].includes(attempt.status))) {
        await tx.update(turn.id, { status: 'unknown', budgetState: 'unknown', error: 'assistant_outcome_unknown', leaseToken: null, leaseUntil: null,
          providerRequests: turn.providerRequests.map(attempt => attempt.status === 'sending' ? { ...attempt, status: 'unknown' } : attempt) });
        return false;
      }
      await tx.update(turn.id, { status: 'running', leaseToken: token, leaseUntil: new Date(this.clock().getTime() + 120000).toISOString() });
      return true;
    });
    if (!claimed) return;
    const input = { ...job, leaseToken: token };
    const heartbeat = setInterval(() => {
      void this.deps.repo.atomic(job.scope, job.threadId, async tx => {
        assertAssistantTurnLease(await tx.turn(job.turnId), token, this.clock());
        await tx.update(job.turnId, { leaseUntil: new Date(this.clock().getTime() + 120000).toISOString() });
      }).catch(() => undefined);
    }, 20000); heartbeat.unref();
    try {
      const response = await this.deps.respond(input);
      await this.deps.repo.atomic(job.scope, job.threadId, async tx => {
        const turn = await tx.turn(job.turnId); assertAssistantTurnLease(turn, token, this.clock());
        if (turn.providerRequests.some(attempt => ['sending', 'unknown'].includes(attempt.status))) return;
        await tx.update(turn.id, { status: 'completed', reply: response.reply, references: response.references, artifacts: response.artifacts,
          budgetState: 'settled', usageCostMicros: turn.usageCostMicros ?? 0n, error: null, leaseToken: null, leaseUntil: null });
      });
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      try { await this.deps.admission.failed(job.scope, job.threadId, job.turnId, token, typeof code === 'string' ? code : undefined); }
      catch { /* A stale worker must not replace another owner's response or uncertainty. */ }
    } finally { clearInterval(heartbeat); }
  }
}
