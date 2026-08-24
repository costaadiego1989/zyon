import { Inject, Injectable , Logger} from "@nestjs/common";
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

export interface StorefrontFunnelResult {
  steps: StorefrontFunnelStep[];
  transitions: StorefrontFunnelTransition[];
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
}

const STOREFRONT_STEP_DEFINITIONS = [
  { name: "checkout_started", label: "Sessão iniciada", events: ["checkout_started"] },
  { name: "product_viewed", label: "Produto visualizado", events: ["product_viewed"] },
  { name: "cart_viewed", label: "Produto adicionado ao carrinho", events: ["cart_viewed"] },
  { name: "auth_phone_submitted", label: "Cadastro iniciado", events: ["auth_phone_submitted"] },
  { name: "auth_phone_verified", label: "Verificou telefone", events: ["auth_phone_verified"] },
  { name: "auth_identity_confirmed", label: "Confirmou identidade", events: ["auth_identity_confirmed"] },
  { name: "auth_registration_completed", label: "Cadastro completo", events: ["auth_registration_completed"] },
  { name: "login_completed", label: "Login realizado", events: ["login_completed"] },
] as const;

@Injectable()
export class GetStorefrontFunnelUseCase {
  private readonly logger = new Logger(GetStorefrontFunnelUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, period: FunnelPeriod = "7d"): Promise<StorefrontFunnelResult> {
    const { from, to } = resolveDateRange(period);

    const events = await this.prisma.checkoutEvent.findMany({
      where: {
        merchantId,
        occurredAt: { gte: from, lte: to },
        // Only storefront sessions (exclude widget checkout sessions starting with "chk_")
        NOT: { sessionId: { startsWith: "chk_" } },
      },
      select: { sessionId: true, eventName: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    });

    // Group events by session — keep first occurrence timestamp per event
    const sessionEvents = new Map<string, Map<string, Date>>();
    for (const ev of events) {
      const map = sessionEvents.get(ev.sessionId) ?? new Map<string, Date>();
      if (!map.has(ev.eventName)) {
        map.set(ev.eventName, ev.occurredAt);
      }
      sessionEvents.set(ev.sessionId, map);
    }

    const totalSessions = sessionEvents.size;

    // Count sessions reaching each step
    const stepCounts = STOREFRONT_STEP_DEFINITIONS.map((def) => {
      let count = 0;
      for (const [, eventMap] of sessionEvents) {
        if (def.events.some((e) => eventMap.has(e))) {
          count++;
        }
      }
      return count;
    });

    const steps: StorefrontFunnelStep[] = STOREFRONT_STEP_DEFINITIONS.map((def, i) => ({
      name: def.name,
      label: def.label,
      count: stepCounts[i],
      percentage: totalSessions > 0 ? Math.round((stepCounts[i] / totalSessions) * 10000) / 100 : 0,
    }));

    // Compute transitions between consecutive steps
    const transitions: StorefrontFunnelTransition[] = [];
    for (let i = 0; i < stepCounts.length - 1; i++) {
      const fromCount = stepCounts[i];
      const toCount = stepCounts[i + 1];
      const rate = fromCount > 0 ? Math.round((toCount / fromCount) * 10000) / 100 : 0;
      const dropOff = fromCount > 0 ? Math.round(((fromCount - toCount) / fromCount) * 10000) / 100 : 0;

      // Compute average time between steps
      const fromEvents = STOREFRONT_STEP_DEFINITIONS[i].events;
      const toEvents = STOREFRONT_STEP_DEFINITIONS[i + 1].events;
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
        from: STOREFRONT_STEP_DEFINITIONS[i].name,
        to: STOREFRONT_STEP_DEFINITIONS[i + 1].name,
        rate,
        dropOff,
        avgTimeSeconds,
      });
    }

    const completedCount = stepCounts[stepCounts.length - 1];
    const overallConversion = totalSessions > 0
      ? Math.round((completedCount / totalSessions) * 10000) / 100
      : 0;

    return {
      steps,
      transitions,
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
