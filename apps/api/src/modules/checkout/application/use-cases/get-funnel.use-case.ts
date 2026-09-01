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

const STEP_DEFINITIONS = [
  { name: "checkout_started", label: "Checkout iniciado", events: [] as string[] },
  { name: "shipping_calculated", label: "Frete selecionado", events: ["shipping_calculated", "shipping_option_selected"] },
  { name: "coupon_applied", label: "Cupom aplicado", events: ["coupon_applied", "coupon_field_clicked"] },
  { name: "payment_method_selected", label: "Pagamento selecionado", events: ["payment_method_selected"] },
  { name: "order_completed", label: "Pagamento concluído", events: ["order_completed"] },
  { name: "payment_failed", label: "Pagamento falhado", events: ["payment_failed"] },
] as const;

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

    // Compute step counts dynamically for all steps
    const stepCounts = STEP_DEFINITIONS.map((def) => {
      let count = 0;
      for (const [, evts] of sessionEvents) {
        // For checkout_started, count is total sessions (any event = started)
        if (def.name === "checkout_started") {
          count = totalSessions;
        } else if (def.events.some(e => evts.some(ev => ev.eventName === e))) {
          count++;
        }
      }
      return count;
    });

    const steps: FunnelStep[] = STEP_DEFINITIONS.map((def, i) => ({
      name: def.name,
      label: def.label,
      count: stepCounts[i],
      percentage: totalSessions > 0 ? Math.round((stepCounts[i] / totalSessions) * 10000) / 100 : 0,
    }));

    // Compute transitions
    const transitions: FunnelTransition[] = [];

    for (let i = 0; i < stepCounts.length - 1; i++) {
      const fromCount = stepCounts[i];
      const toCount = stepCounts[i + 1];
      const rate = fromCount > 0 ? Math.round((toCount / fromCount) * 10000) / 100 : 0;
      // Drop-off is only meaningful when the next step is a strict subset of the
      // current one (linear funnel). Optional steps (coupon) or non-monotonic
      // ordering (order_completed counted separately from payment) can make
      // toCount > fromCount, which would yield a nonsensical negative drop-off.
      // Clamp to [0, 100] so the UI never shows "-250% saiu".
      const rawDropOff = fromCount > 0 ? ((fromCount - toCount) / fromCount) * 100 : 0;
      const dropOff = Math.round(Math.max(0, Math.min(100, rawDropOff)) * 100) / 100;

      const avgTimeSeconds = computeAvgTimeBetweenSteps(
        sessionEvents,
        i,
        STEP_DEFINITIONS,
      );

      transitions.push({
        from: STEP_DEFINITIONS[i].name,
        to: STEP_DEFINITIONS[i + 1].name,
        rate,
        dropOff,
        avgTimeSeconds,
      });
    }

    // Identify bottleneck (worst drop-off)
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

    const completedStepIdx = STEP_DEFINITIONS.findIndex(d => d.name === "order_completed");
    const completedCount = completedStepIdx >= 0 ? stepCounts[completedStepIdx] : 0;
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
      select: { id: true, globalUserId: true },
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
        returningSessionIds.push(s.id);
      } else {
        newSessionIds.push(s.id);
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
    for (const method of ["pix", "card", "boleto"]) {
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

    const stepCounts = STEP_DEFINITIONS.map((def) => {
      if (def.name === "checkout_started") return total;
      return allSets.filter(s => def.events.some(e => s.has(e))).length;
    });

    const steps: FunnelStep[] = STEP_DEFINITIONS.map((def, i) => ({
      name: def.name,
      label: def.label,
      count: stepCounts[i],
      percentage: total > 0 ? Math.round((stepCounts[i] / total) * 10000) / 100 : 0,
    }));

    const completedIdx = STEP_DEFINITIONS.findIndex(d => d.name === "order_completed");
    const completedCount = completedIdx >= 0 ? stepCounts[completedIdx] : 0;

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

function computeAvgTimeBetweenSteps(
  sessionEvents: Map<string, Array<{ eventName: string; occurredAt: Date }>>,
  stepIndex: number,
  stepDefs: typeof STEP_DEFINITIONS,
): number {
  const timeDiffs: number[] = [];
  const fromEvents = stepIndex === 0 ? null : stepDefs[stepIndex].events;
  const toEvents = stepDefs[stepIndex + 1].events;

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
