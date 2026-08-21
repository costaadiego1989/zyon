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
}

export interface StorefrontFunnelResult {
  steps: StorefrontFunnelStep[];
  transitions: StorefrontFunnelTransition[];
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
}

const STOREFRONT_STEP_DEFINITIONS = [
  { name: "checkout_started", label: "Visitou a loja", events: ["checkout_started"] },
  { name: "product_viewed", label: "Viu produto", events: ["product_viewed"] },
  { name: "cart_viewed", label: "Adicionou ao carrinho", events: ["cart_viewed"] },
  { name: "auth_phone_submitted", label: "Informou telefone", events: ["auth_phone_submitted"] },
  { name: "auth_phone_verified", label: "Verificou OTP", events: ["auth_phone_verified"] },
  { name: "auth_identity_confirmed", label: "Confirmou identidade", events: ["auth_identity_confirmed"] },
  { name: "auth_registration_completed", label: "Cadastro concluído", events: ["auth_registration_completed"] },
  { name: "shipping_calculated", label: "Calculou frete", events: ["shipping_calculated", "shipping_option_selected"] },
  { name: "cross_sell_added", label: "Aceitou cross-sell", events: ["cross_sell_accepted", "cross_sell_added"] },
  { name: "coupon_applied", label: "Aplicou cupom", events: ["coupon_applied", "coupon_field_clicked"] },
  { name: "payment_method_selected", label: "Selecionou pagamento", events: ["payment_method_selected"] },
  { name: "order_completed", label: "Pedido confirmado", events: ["order_completed"] },
  { name: "sale_declined", label: "Venda recusada", events: ["payment_failed", "sale_declined"] },
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

    // Group events by session
    const sessionEvents = new Map<string, Set<string>>();
    for (const ev of events) {
      const set = sessionEvents.get(ev.sessionId) ?? new Set();
      set.add(ev.eventName);
      sessionEvents.set(ev.sessionId, set);
    }

    const totalSessions = sessionEvents.size;

    // Count sessions reaching each step
    const stepCounts = STOREFRONT_STEP_DEFINITIONS.map((def) => {
      let count = 0;
      for (const [, eventNames] of sessionEvents) {
        if (def.events.some((e) => eventNames.has(e))) {
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

      transitions.push({
        from: STOREFRONT_STEP_DEFINITIONS[i].name,
        to: STOREFRONT_STEP_DEFINITIONS[i + 1].name,
        rate,
        dropOff,
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
