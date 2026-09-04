import { Inject, Injectable , Logger} from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

type FunnelPeriod = "today" | "7d" | "30d" | "90d";
type FunnelBreakdown = "device" | "buyer_type" | "payment_method";

interface FunnelStep {
  name: string;
  label: string;
  count: number;
  percentage: number;
}

interface FunnelTransition {
  from: string;
  to: string;
  rate: number;
  dropOff: number;
  avgTimeSeconds: number;
}

interface FunnelBottleneck {
  step: string;
  dropOff: number;
  suggestion: string;
}

interface FunnelSegment {
  steps: FunnelStep[];
  overallConversion: number;
}

interface FunnelPreviousPeriod {
  steps: FunnelStep[];
  overallConversion: number;
  totalSessions: number;
}

export interface FunnelResult {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
  bottleneck: FunnelBottleneck | null;
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
  breakdowns?: Record<string, FunnelSegment>;
  previous?: FunnelPreviousPeriod;
}

// `linear: true` marks the ordered cascade a session must pass through in
// sequence (started → shipping → payment → completed). Transitions, drop-off
// and the bottleneck are computed ONLY over linear steps, and counts are made
// monotonic by the "furthest linear step reached" rule so a later step can
// never out-count an earlier one (which produced impossible >100% rates and a
// false "order_completed 100% drop-off" bottleneck).
//
// `coupon_applied` is optional (a buyer can pay without a coupon) and
// `payment_failed` is a branch outcome, not a forward step — both are reported
// as informational side-metrics (their raw share of total sessions) but are
// excluded from the linear cascade so they never distort the funnel.
const STEP_DEFINITIONS = [
  { name: "checkout_started", label: "Checkout iniciado", events: [] as string[], linear: true },
  { name: "shipping_calculated", label: "Frete selecionado", events: ["shipping_calculated", "shipping_option_selected"], linear: true },
  { name: "coupon_applied", label: "Cupom aplicado", events: ["coupon_applied", "coupon_field_clicked"], linear: false },
  { name: "payment_method_selected", label: "Pagamento selecionado", events: ["payment_method_selected"], linear: true },
  { name: "order_completed", label: "Pagamento concluído", events: ["order_completed"], linear: true },
  { name: "payment_failed", label: "Pagamento falhado", events: ["payment_failed"], linear: false },
] as const;

// The ordered linear cascade, in sequence. Index in this array = funnel depth.
const LINEAR_STEPS = STEP_DEFINITIONS.filter((d) => d.linear);

@Injectable()
export class GetFunnelUseCase {
  private readonly logger = new Logger(GetFunnelUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(
    merchantId: string,
    period: FunnelPeriod = "7d",
    options?: { breakdown?: FunnelBreakdown; compare?: boolean; range?: { from?: string; to?: string } },
  ): Promise<FunnelResult> {
    const { from, to } = resolveEffectiveRange(period, options?.range);

    const currentResult = await this.computeFunnel(merchantId, from, to);

    const result: FunnelResult = { ...currentResult, period: { from: from.toISOString(), to: to.toISOString() } };

    // ── Breakdown ──
    if (options?.breakdown) {
      result.breakdowns = await this.computeBreakdowns(merchantId, from, to, options.breakdown);
    }

    // ── Period Comparison ──
    if (options?.compare) {
      const durationMs = to.getTime() - from.getTime();
      const prevTo = new Date(from.getTime() - 1); // 1ms before current period start
      const prevFrom = new Date(prevTo.getTime() - durationMs);
      const prev = await this.computeFunnel(merchantId, prevFrom, prevTo);
      result.previous = {
        steps: prev.steps,
        overallConversion: prev.overallConversion,
        totalSessions: prev.totalSessions,
      };
    }

    return result;
  }

  private async computeFunnel(merchantId: string, from: Date, to: Date) {
    // Get all events in period for this merchant (only checkout widget sessions)
    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        occurredAt: { gte: from, lte: to },
        sessionId: { startsWith: "chk_" },
      },
      select: { sessionId: true, eventName: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    });

    // Group events by session
    const sessionEvents = new Map<string, Array<{ eventName: string; occurredAt: Date }>>();
    for (const ev of events) {
      const list = sessionEvents.get(ev.sessionId) ?? [];
      list.push({ eventName: ev.eventName, occurredAt: ev.occurredAt });
      sessionEvents.set(ev.sessionId, list);
    }

    const totalSessions = sessionEvents.size;

    // Which linear-cascade events each session emitted (as a Set for lookup).
    const sessionEventSets = new Map<string, Set<string>>();
    for (const [sid, evts] of sessionEvents) {
      sessionEventSets.set(sid, new Set(evts.map((e) => e.eventName)));
    }

    // Monotonic linear counts via "furthest linear step reached". A session that
    // reached linear step N is counted in every linear step 0..N, so counts can
    // only decrease down the cascade — rate ≤ 100% and drop-off stays valid even
    // when a completed order never emitted an intermediate step (e.g. free
    // shipping skips shipping_calculated).
    const linearReachedCount = new Array(LINEAR_STEPS.length).fill(0);
    for (const [, evtSet] of sessionEventSets) {
      let furthest = 0; // index 0 = checkout_started, reached by every session
      for (let i = 1; i < LINEAR_STEPS.length; i++) {
        if (LINEAR_STEPS[i].events.some((e) => evtSet.has(e))) furthest = i;
      }
      for (let i = 0; i <= furthest; i++) linearReachedCount[i]++;
    }

    // Optional / branch steps report their own raw share of total sessions —
    // they are NOT part of the cascade, so they never affect transitions.
    const rawStepCount = (def: (typeof STEP_DEFINITIONS)[number]): number => {
      if (def.name === "checkout_started") return totalSessions;
      let c = 0;
      for (const [, evtSet] of sessionEventSets) {
        if (def.events.some((e) => evtSet.has(e))) c++;
      }
      return c;
    };

    const linearIndexByName = new Map<string, number>(LINEAR_STEPS.map((d, i) => [d.name as string, i]));
    const stepCountByName = new Map<string, number>();
    const steps: FunnelStep[] = STEP_DEFINITIONS.map((def) => {
      const li = linearIndexByName.get(def.name);
      const count = li !== undefined ? linearReachedCount[li] : rawStepCount(def);
      stepCountByName.set(def.name, count);
      return {
        name: def.name,
        label: def.label,
        count,
        percentage: totalSessions > 0 ? Math.round((count / totalSessions) * 10000) / 100 : 0,
      };
    });

    // Transitions computed ONLY over the linear cascade (monotonic counts).
    const transitions: FunnelTransition[] = [];
    for (let i = 0; i < LINEAR_STEPS.length - 1; i++) {
      const fromCount = linearReachedCount[i];
      const toCount = linearReachedCount[i + 1];
      const rate = fromCount > 0 ? Math.round((toCount / fromCount) * 10000) / 100 : 0;
      const dropOff = fromCount > 0
        ? Math.round(((fromCount - toCount) / fromCount) * 10000) / 100
        : 0;

      const avgTimeSeconds = computeAvgTimeBetweenLinearSteps(sessionEvents, i);

      transitions.push({
        from: LINEAR_STEPS[i].name,
        to: LINEAR_STEPS[i + 1].name,
        rate,
        dropOff,
        avgTimeSeconds,
      });
    }

    // Bottleneck = worst drop-off across linear transitions only. `payment_failed`
    // is no longer a "next step", so the success terminal (order_completed) can
    // never be falsely flagged as a 100%-drop bottleneck.
    let bottleneck: FunnelBottleneck | null = null;
    if (transitions.length > 0) {
      const worst = transitions.reduce((max, t) => t.dropOff > max.dropOff ? t : max, transitions[0]);
      if (worst.dropOff > 0) {
        bottleneck = {
          step: worst.from,
          dropOff: worst.dropOff,
          suggestion: buildSuggestion(worst.from, worst.dropOff),
        };
      }
    }

    const completedCount = stepCountByName.get("order_completed") ?? 0;
    const overallConversion = totalSessions > 0
      ? Math.round((completedCount / totalSessions) * 10000) / 100
      : 0;

    return {
      steps,
      transitions,
      bottleneck,
      totalSessions,
      overallConversion,
    };
  }

  private async computeBreakdowns(
    merchantId: string,
    from: Date,
    to: Date,
    dimension: FunnelBreakdown,
  ): Promise<Record<string, FunnelSegment>> {
    switch (dimension) {
      case "buyer_type":
        return this.computeBuyerTypeBreakdown(merchantId, from, to);
      case "device":
        return this.computeDeviceBreakdown(merchantId, from, to);
      case "payment_method":
        return this.computePaymentMethodBreakdown(merchantId, from, to);
    }
  }

  private async computeBuyerTypeBreakdown(
    merchantId: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, FunnelSegment>> {
    // Get all sessions in the period
    const sessions = await this.prisma.checkoutSession.findMany({
      where: {
        merchantId,
        createdAt: { gte: from, lte: to },
      },
      // Business sessionId (not the cuid PK): checkout_events.sessionId matches on it.
      select: { sessionId: true, globalUserId: true },
    });

    // Determine which globalUserIds had sessions BEFORE this period
    const globalUserIds = [...new Set(sessions.map(s => s.globalUserId).filter(Boolean))] as string[];

    const returningUserIds = new Set<string>();
    if (globalUserIds.length > 0) {
      const previousSessions = await this.prisma.checkoutSession.findMany({
        where: {
          merchantId,
          globalUserId: { in: globalUserIds },
          createdAt: { lt: from },
        },
        select: { globalUserId: true },
      });
      for (const ps of previousSessions) {
        if (ps.globalUserId) returningUserIds.add(ps.globalUserId);
      }
    }

    // Partition session IDs
    const newSessionIds: string[] = [];
    const returningSessionIds: string[] = [];
    for (const s of sessions) {
      if (s.globalUserId && returningUserIds.has(s.globalUserId)) {
        returningSessionIds.push(s.sessionId);
      } else {
        newSessionIds.push(s.sessionId);
      }
    }

    const [newSegment, returningSegment] = await Promise.all([
      this.computeSegmentSteps(merchantId, from, to, newSessionIds),
      this.computeSegmentSteps(merchantId, from, to, returningSessionIds),
    ]);

    return {
      new: newSegment,
      returning: returningSegment,
    };
  }

  private async computeDeviceBreakdown(
    merchantId: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, FunnelSegment>> {
    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        sessionId: { startsWith: "chk_" },
        occurredAt: { gte: from, lte: to },
      },
      select: { sessionId: true, metadata: true },
    });

    const sessionsByDevice = new Map<string, string[]>();
    for (const ev of events) {
      const device = (ev.metadata as any)?.device ?? null;
      if (!device) continue;
      const list = sessionsByDevice.get(device) ?? [];
      if (!list.includes(ev.sessionId)) list.push(ev.sessionId);
      sessionsByDevice.set(device, list);
    }

    const breakdowns: Record<string, FunnelSegment> = {};
    for (const device of ["mobile", "tablet", "desktop"]) {
      const sessionIds = sessionsByDevice.get(device) ?? [];
      breakdowns[device] = await this.computeSegmentSteps(merchantId, from, to, sessionIds);
    }
    return breakdowns;
  }

  private async computePaymentMethodBreakdown(
    merchantId: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, FunnelSegment>> {
    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        sessionId: { startsWith: "chk_" },
        occurredAt: { gte: from, lte: to },
      },
      select: { sessionId: true, metadata: true },
    });

    const sessionsByMethod = new Map<string, string[]>();
    for (const ev of events) {
      const method = (ev.metadata as any)?.payment_method ?? null;
      if (!method) continue;
      const list = sessionsByMethod.get(method) ?? [];
      if (!list.includes(ev.sessionId)) list.push(ev.sessionId);
      sessionsByMethod.set(method, list);
    }

    const breakdowns: Record<string, FunnelSegment> = {};
    // Canonical PaymentMethod values as stored on the event metadata.
    for (const method of ["pix", "credit_card", "boleto", "crypto"]) {
      const sessionIds = sessionsByMethod.get(method) ?? [];
      breakdowns[method] = await this.computeSegmentSteps(merchantId, from, to, sessionIds);
    }
    return breakdowns;
  }

  private async computeSegmentSteps(
    merchantId: string,
    from: Date,
    to: Date,
    sessionIds: string[],
  ): Promise<FunnelSegment> {
    if (sessionIds.length === 0) {
      return {
        steps: STEP_DEFINITIONS.map(def => ({ name: def.name, label: def.label, count: 0, percentage: 0 })),
        overallConversion: 0,
      };
    }

    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        sessionId: { in: sessionIds },
        occurredAt: { gte: from, lte: to },
      },
      select: { sessionId: true, eventName: true },
    });

    const sessionEventNames = new Map<string, Set<string>>();
    for (const ev of events) {
      const set = sessionEventNames.get(ev.sessionId) ?? new Set();
      set.add(ev.eventName);
      sessionEventNames.set(ev.sessionId, set);
    }

    const total = sessionEventNames.size;
    const allSets = [...sessionEventNames.values()];

    // Monotonic linear counts (same "furthest reached" rule as the main funnel).
    const linearReached = new Array(LINEAR_STEPS.length).fill(0);
    for (const s of allSets) {
      let furthest = 0;
      for (let i = 1; i < LINEAR_STEPS.length; i++) {
        if (LINEAR_STEPS[i].events.some((e) => s.has(e))) furthest = i;
      }
      for (let i = 0; i <= furthest; i++) linearReached[i]++;
    }
    const linearIdxByName = new Map<string, number>(LINEAR_STEPS.map((d, i) => [d.name as string, i]));

    const steps: FunnelStep[] = STEP_DEFINITIONS.map((def) => {
      const li = linearIdxByName.get(def.name);
      const count = li !== undefined
        ? linearReached[li]
        : (def.name === "checkout_started" ? total : allSets.filter(s => def.events.some(e => s.has(e))).length);
      return {
        name: def.name,
        label: def.label,
        count,
        percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
      };
    });

    const completedIdx = linearIdxByName.get("order_completed");
    const completedCount = completedIdx !== undefined ? linearReached[completedIdx] : 0;

    return {
      steps,
      overallConversion: total > 0 ? Math.round((completedCount / total) * 10000) / 100 : 0,
    };
  }
}

function resolveDateRange(period: FunnelPeriod): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  const from = new Date(now);

  switch (period) {
    case "today":
      from.setHours(0, 0, 0, 0);
      break;
    case "7d":
      from.setDate(from.getDate() - 7);
      break;
    case "30d":
      from.setDate(from.getDate() - 30);
      break;
    case "90d":
      from.setDate(from.getDate() - 90);
      break;
    default:
      from.setDate(from.getDate() - 7);
  }

  return { from, to };
}

/**
 * When an explicit from/to range is supplied (YYYY-MM-DD or ISO), it overrides
 * the preset period. Invalid or partial ranges fall back to the preset period.
 * `from` clamps to start-of-day, `to` clamps to end-of-day.
 */
function resolveEffectiveRange(
  period: FunnelPeriod,
  range?: { from?: string; to?: string },
): { from: Date; to: Date } {
  if (range?.from && range?.to) {
    const from = new Date(range.from);
    const to = new Date(range.to);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
  }
  return resolveDateRange(period);
}

function computeAvgTimeBetweenLinearSteps(
  sessionEvents: Map<string, Array<{ eventName: string; occurredAt: Date }>>,
  stepIndex: number,
): number {
  const timeDiffs: number[] = [];
  const fromEvents = stepIndex === 0 ? null : LINEAR_STEPS[stepIndex].events;
  const toEvents = LINEAR_STEPS[stepIndex + 1].events;

  for (const [, evts] of sessionEvents) {
    // First occurrence of "from" step event
    let fromTime: Date | null = null;
    if (stepIndex === 0) {
      // First event = checkout_started
      fromTime = evts[0]?.occurredAt ?? null;
    } else {
      for (const ev of evts) {
        if ((fromEvents as readonly string[]).includes(ev.eventName)) {
          fromTime = ev.occurredAt;
          break;
        }
      }
    }

    // First occurrence of "to" step event
    let toTime: Date | null = null;
    for (const ev of evts) {
      if ((toEvents as readonly string[]).includes(ev.eventName)) {
        toTime = ev.occurredAt;
        break;
      }
    }

    if (fromTime && toTime) {
      const diff = (toTime.getTime() - fromTime.getTime()) / 1000;
      if (diff >= 0) timeDiffs.push(diff);
    }
  }

  if (timeDiffs.length === 0) return 0;

  // Median
  timeDiffs.sort((a, b) => a - b);
  const mid = Math.floor(timeDiffs.length / 2);
  const median = timeDiffs.length % 2 === 0
    ? (timeDiffs[mid - 1] + timeDiffs[mid]) / 2
    : timeDiffs[mid];

  return Math.round(median);
}

function buildSuggestion(step: string, dropOff: number): string {
  const pct = dropOff.toFixed(0);
  switch (step) {
    case "checkout_started":
      return `${pct}% sai no cadastro — simplifique campos obrigatórios ou ofereça login social`;
    case "shipping_calculated":
      return `${pct}% abandona no frete — considere frete grátis ou desconto no envio`;
    case "payment_method_selected":
      return `${pct}% desiste no pagamento — verifique métodos disponíveis (PIX, parcelamento)`;
    default:
      return `${pct}% de drop-off nesta etapa`;
  }
}
