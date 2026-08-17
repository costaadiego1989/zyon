import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

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
  { name: "checkout_started", label: "Checkout Iniciado", events: [] as string[] },
  { name: "shipping", label: "Frete", events: ["shipping_calculated", "shipping_option_selected"] },
  { name: "payment", label: "Pagamento", events: ["payment_method_selected"] },
  { name: "completed", label: "Concluído", events: ["order_completed"] },
] as const;

@Injectable()
export class GetFunnelUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(
    merchantId: string,
    period: FunnelPeriod = "7d",
    options?: { breakdown?: FunnelBreakdown; compare?: boolean },
  ): Promise<FunnelResult> {
    const { from, to } = resolveDateRange(period);

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
    // Get all events in period for this merchant
    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        occurredAt: { gte: from, lte: to },
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

    // Step 1: any session with any event = checkout_started
    const step1Count = totalSessions;

    // Step 2: sessions with shipping_calculated or shipping_option_selected
    const step2Sessions = new Set<string>();
    for (const [sid, evts] of sessionEvents) {
      if (evts.some(e => e.eventName === "shipping_calculated" || e.eventName === "shipping_option_selected")) {
        step2Sessions.add(sid);
      }
    }

    // Step 3: sessions with payment_method_selected
    const step3Sessions = new Set<string>();
    for (const [sid, evts] of sessionEvents) {
      if (evts.some(e => e.eventName === "payment_method_selected")) {
        step3Sessions.add(sid);
      }
    }

    // Step 4: sessions with order_completed
    const step4Sessions = new Set<string>();
    for (const [sid, evts] of sessionEvents) {
      if (evts.some(e => e.eventName === "order_completed")) {
        step4Sessions.add(sid);
      }
    }

    const stepCounts = [step1Count, step2Sessions.size, step3Sessions.size, step4Sessions.size];

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
      const dropOff = fromCount > 0 ? Math.round(((fromCount - toCount) / fromCount) * 10000) / 100 : 0;

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

    const overallConversion = totalSessions > 0
      ? Math.round((step4Sessions.size / totalSessions) * 10000) / 100
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
    _merchantId: string,
    _from: Date,
    _to: Date,
  ): Promise<Record<string, FunnelSegment>> {
    // TODO: Implement when device tracking is added to checkout_events metadata.
    // Currently returns mock breakdown structure for UI development.
    return {
      mobile: { steps: buildMockSteps(65), overallConversion: 22.5 },
      desktop: { steps: buildMockSteps(85), overallConversion: 31.2 },
      tablet: { steps: buildMockSteps(40), overallConversion: 18.0 },
    };
  }

  private async computePaymentMethodBreakdown(
    _merchantId: string,
    _from: Date,
    _to: Date,
  ): Promise<Record<string, FunnelSegment>> {
    // TODO: Implement when payment method metadata is stored on checkout_events.
    // Currently CheckoutEvent does not have a metadata column, so we cannot
    // extract the payment method from event data. Returns mock breakdown for UI development.
    return {
      pix: { steps: buildMockSteps(55), overallConversion: 28.0 },
      card: { steps: buildMockSteps(70), overallConversion: 24.5 },
      boleto: { steps: buildMockSteps(30), overallConversion: 15.2 },
    };
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
    const step2 = [...sessionEventNames.values()].filter(s => s.has("shipping_calculated") || s.has("shipping_option_selected")).length;
    const step3 = [...sessionEventNames.values()].filter(s => s.has("payment_method_selected")).length;
    const step4 = [...sessionEventNames.values()].filter(s => s.has("order_completed")).length;

    const stepCounts = [total, step2, step3, step4];

    const steps: FunnelStep[] = STEP_DEFINITIONS.map((def, i) => ({
      name: def.name,
      label: def.label,
      count: stepCounts[i],
      percentage: total > 0 ? Math.round((stepCounts[i] / total) * 10000) / 100 : 0,
    }));

    return {
      steps,
      overallConversion: total > 0 ? Math.round((step4 / total) * 10000) / 100 : 0,
    };
  }
}

function buildMockSteps(baseCount: number): FunnelStep[] {
  const counts = [baseCount, Math.round(baseCount * 0.7), Math.round(baseCount * 0.45), Math.round(baseCount * 0.25)];
  return STEP_DEFINITIONS.map((def, i) => ({
    name: def.name,
    label: def.label,
    count: counts[i],
    percentage: baseCount > 0 ? Math.round((counts[i] / counts[0]) * 10000) / 100 : 0,
  }));
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
