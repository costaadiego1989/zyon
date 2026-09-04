import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

type FunnelPeriod = "today" | "7d" | "30d" | "90d";

interface StorefrontFunnelStep {
  name: string;
  label: string;
  count: number;
  percentage: number;
}

interface StorefrontFunnelTransition {
  from: string;
  to: string;
  rate: number;
  dropOff: number;
  avgTimeSeconds: number;
}

interface StorefrontFunnelSegment {
  steps: StorefrontFunnelStep[];
  overallConversion: number;
}

interface StorefrontFunnelPreviousPeriod {
  steps: StorefrontFunnelStep[];
  overallConversion: number;
  totalSessions: number;
}

type FunnelBreakdown = "device" | "buyer_type" | "payment_method";

export interface StorefrontFunnelResult {
  steps: StorefrontFunnelStep[];
  transitions: StorefrontFunnelTransition[];
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
  breakdowns?: Record<string, StorefrontFunnelSegment>;
  previous?: StorefrontFunnelPreviousPeriod;
}

// `linear: true` = the ordered acquisition cascade a NEW visitor passes through
// in sequence (browsing → phone signup → registration complete). Counts over
// these are made monotonic by the "furthest linear step reached" rule so a later
// step can never out-count an earlier one.
//
// `login_completed` is a RETURNING-user branch, not step 8 of the new-user
// signup: a returning buyer logs in without ever emitting the phone-signup
// events. Treating it as the terminal step produced the nonsensical
// "78 → 0 → 0 → 0 → 20" cascade (four zero signup steps then a nonzero login).
// It is reported as an informational side-metric, excluded from the linear
// cascade so it never distorts transitions/drop-off.
const STOREFRONT_STEP_DEFINITIONS = [
  { name: "checkout_started", label: "Sessão iniciada", events: ["checkout_started"], linear: true },
  { name: "product_viewed", label: "Produto visualizado", events: ["product_viewed"], linear: true },
  { name: "cart_viewed", label: "Produto adicionado ao carrinho", events: ["cart_viewed"], linear: true },
  { name: "auth_phone_submitted", label: "Cadastro iniciado", events: ["auth_phone_submitted"], linear: true },
  { name: "auth_phone_verified", label: "Verificou telefone", events: ["auth_phone_verified"], linear: true },
  { name: "auth_identity_confirmed", label: "Confirmou identidade", events: ["auth_identity_confirmed"], linear: true },
  { name: "auth_registration_completed", label: "Cadastro completo", events: ["auth_registration_completed"], linear: true },
  { name: "login_completed", label: "Login realizado", events: ["login_completed"], linear: false },
] as const;

// Ordered linear cascade, in sequence. Index = funnel depth.
const STOREFRONT_LINEAR_STEPS = STOREFRONT_STEP_DEFINITIONS.filter((d) => d.linear);

@Injectable()
export class GetStorefrontFunnelUseCase {
  private readonly logger = new Logger(GetStorefrontFunnelUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, period: FunnelPeriod = "7d", options?: { breakdown?: FunnelBreakdown; compare?: boolean; range?: { from?: string; to?: string } }): Promise<StorefrontFunnelResult> {
    const { from, to } = resolveEffectiveRange(period, options?.range);

    const currentResult = await this.computeFunnel(merchantId, from, to);
    const result: StorefrontFunnelResult = { ...currentResult, period: { from: from.toISOString(), to: to.toISOString() } };

    if (options?.breakdown) {
      result.breakdowns = await this.computeBreakdowns(merchantId, from, to, options.breakdown);
    }

    if (options?.compare) {
      const durationMs = to.getTime() - from.getTime();
      const prevTo = new Date(from.getTime() - 1);
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
    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        occurredAt: { gte: from, lte: to },
        NOT: { sessionId: { startsWith: "chk_" } },
      },
      select: { sessionId: true, eventName: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    });

    const sessionEvents = new Map<string, Map<string, Date>>();
    for (const ev of events) {
      const map = sessionEvents.get(ev.sessionId) ?? new Map<string, Date>();
      if (!map.has(ev.eventName)) {
        map.set(ev.eventName, ev.occurredAt);
      }
      sessionEvents.set(ev.sessionId, map);
    }

    const totalSessions = sessionEvents.size;

    // Monotonic linear counts via "furthest linear step reached": a session that
    // reached linear step N is counted in every linear step 0..N, so counts only
    // decrease down the cascade (rate ≤ 100%, valid drop-off).
    const linearReachedCount = new Array(STOREFRONT_LINEAR_STEPS.length).fill(0);
    for (const [, eventMap] of sessionEvents) {
      let furthest = -1;
      for (let i = 0; i < STOREFRONT_LINEAR_STEPS.length; i++) {
        if (STOREFRONT_LINEAR_STEPS[i].events.some((e) => eventMap.has(e))) furthest = i;
      }
      for (let i = 0; i <= furthest; i++) linearReachedCount[i]++;
    }

    // Branch / side-metric steps report their own raw share of sessions.
    const rawStepCount = (def: (typeof STOREFRONT_STEP_DEFINITIONS)[number]): number => {
      let c = 0;
      for (const [, eventMap] of sessionEvents) {
        if (def.events.some((e) => eventMap.has(e))) c++;
      }
      return c;
    };

    const linearIndexByName = new Map<string, number>(
      STOREFRONT_LINEAR_STEPS.map((d, i) => [d.name as string, i]),
    );
    const steps: StorefrontFunnelStep[] = STOREFRONT_STEP_DEFINITIONS.map((def) => {
      const li = linearIndexByName.get(def.name);
      const count = li !== undefined ? linearReachedCount[li] : rawStepCount(def);
      return {
        name: def.name,
        label: def.label,
        count,
        percentage: totalSessions > 0 ? Math.round((count / totalSessions) * 10000) / 100 : 0,
      };
    });

    // Transitions over the linear cascade only.
    const transitions: StorefrontFunnelTransition[] = [];
    for (let i = 0; i < STOREFRONT_LINEAR_STEPS.length - 1; i++) {
      const fromCount = linearReachedCount[i];
      const toCount = linearReachedCount[i + 1];
      const rate = fromCount > 0 ? Math.round((toCount / fromCount) * 10000) / 100 : 0;
      const dropOff = fromCount > 0 ? Math.round(((fromCount - toCount) / fromCount) * 10000) / 100 : 0;

      const fromEvents = STOREFRONT_LINEAR_STEPS[i].events;
      const toEvents = STOREFRONT_LINEAR_STEPS[i + 1].events;
      let totalTimeSec = 0;
      let timeCount = 0;
      for (const [, eventMap] of sessionEvents) {
        const fromTime = fromEvents.reduce<Date | null>((earliest, e) => {
          const t = eventMap.get(e);
          return t && (!earliest || t < earliest) ? t : earliest;
        }, null);
        const toTime = toEvents.reduce<Date | null>((earliest, e) => {
          const t = eventMap.get(e);
          return t && (!earliest || t < earliest) ? t : earliest;
        }, null);
        if (fromTime && toTime && toTime > fromTime) {
          totalTimeSec += (toTime.getTime() - fromTime.getTime()) / 1000;
          timeCount++;
        }
      }
      const avgTimeSeconds = timeCount > 0 ? Math.round(totalTimeSec / timeCount) : 0;

      transitions.push({
        from: STOREFRONT_LINEAR_STEPS[i].name,
        to: STOREFRONT_LINEAR_STEPS[i + 1].name,
        rate,
        dropOff,
        avgTimeSeconds,
      });
    }

    // Overall conversion = reached the end of the linear signup cascade.
    const completedCount = linearReachedCount[STOREFRONT_LINEAR_STEPS.length - 1] ?? 0;
    const overallConversion = totalSessions > 0
      ? Math.round((completedCount / totalSessions) * 10000) / 100
      : 0;

    return {
      steps,
      transitions,
      totalSessions,
      overallConversion,
    };
  }

  private async computeBreakdowns(
    merchantId: string,
    from: Date,
    to: Date,
    dimension: FunnelBreakdown,
  ): Promise<Record<string, StorefrontFunnelSegment>> {
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
  ): Promise<Record<string, StorefrontFunnelSegment>> {
    const sessions = await this.prisma.checkoutSession.findMany({
      where: {
        merchantId,
        createdAt: { gte: from, lte: to },
        NOT: { sessionId: { startsWith: "chk_" } },
      },
      // Use the business sessionId (not the cuid PK): checkout_events.sessionId
      // stores the business sessionId, so segment step-counting must match on it.
      select: { sessionId: true, globalUserId: true },
    });

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
  ): Promise<Record<string, StorefrontFunnelSegment>> {
    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        NOT: { sessionId: { startsWith: "chk_" } },
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

    const breakdowns: Record<string, StorefrontFunnelSegment> = {};
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
  ): Promise<Record<string, StorefrontFunnelSegment>> {
    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        NOT: { sessionId: { startsWith: "chk_" } },
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

    const breakdowns: Record<string, StorefrontFunnelSegment> = {};
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
  ): Promise<StorefrontFunnelSegment> {
    if (sessionIds.length === 0) {
      return {
        steps: STOREFRONT_STEP_DEFINITIONS.map(def => ({ name: def.name, label: def.label, count: 0, percentage: 0 })),
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
    const linearReached = new Array(STOREFRONT_LINEAR_STEPS.length).fill(0);
    for (const s of allSets) {
      let furthest = -1;
      for (let i = 0; i < STOREFRONT_LINEAR_STEPS.length; i++) {
        if (STOREFRONT_LINEAR_STEPS[i].events.some((e) => s.has(e))) furthest = i;
      }
      for (let i = 0; i <= furthest; i++) linearReached[i]++;
    }
    const linearIdxByName = new Map<string, number>(
      STOREFRONT_LINEAR_STEPS.map((d, i) => [d.name as string, i]),
    );

    const steps: StorefrontFunnelStep[] = STOREFRONT_STEP_DEFINITIONS.map((def) => {
      const li = linearIdxByName.get(def.name);
      const count = li !== undefined
        ? linearReached[li]
        : allSets.filter(s => def.events.some(e => s.has(e))).length;
      return {
        name: def.name,
        label: def.label,
        count,
        percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
      };
    });

    const completedCount = linearReached[STOREFRONT_LINEAR_STEPS.length - 1] ?? 0;

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
 * `from` clamps to start-of-day, `to` clamps to end-of-day, so a single-day
 * range (from === to) covers the whole day.
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
