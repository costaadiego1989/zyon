import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

type FunnelPeriod = "today" | "7d" | "30d" | "90d";

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

export interface FunnelResult {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
  bottleneck: FunnelBottleneck | null;
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
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

  async execute(merchantId: string, period: FunnelPeriod = "7d"): Promise<FunnelResult> {
    const { from, to } = resolveDateRange(period);

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
    const stepSets: Array<Set<string> | null> = [null, step2Sessions, step3Sessions, step4Sessions];

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
      period: { from: from.toISOString(), to: to.toISOString() },
      totalSessions,
      overallConversion,
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
      return `${pct}% abandona no frete — considere oferecer frete grátis`;
    case "shipping":
      return `${pct}% abandona no pagamento — verifique formas de pagamento disponíveis`;
    case "payment":
      return `${pct}% abandona na finalização — simplifique o fluxo de confirmação`;
    default:
      return `${pct}% de drop-off nesta etapa`;
  }
}
