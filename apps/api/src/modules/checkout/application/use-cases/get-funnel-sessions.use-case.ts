import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { CustomerHints } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

interface FunnelSession {
  sessionId: string;
  currentStep: string;
  buyerHint: string;
  updatedAt: string;
  cartTotal: number;
  itemCount: number;
}

export interface FunnelSessionsResult {
  sessions: FunnelSession[];
  total: number;
}

const STEP_PRIORITY: Record<string, number> = {
  order_completed: 4,
  payment_method_selected: 3,
  shipping_calculated: 2,
  shipping_option_selected: 2,
};

@Injectable()
export class GetFunnelSessionsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<FunnelSessionsResult> {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    const sessions = await this.prisma.checkoutSession.findMany({
      where: {
        merchantId,
        updatedAt: { gte: thirtyMinAgo },
      },
      include: {
        events: {
          select: { eventName: true },
          orderBy: { occurredAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    const result: FunnelSession[] = sessions.map((s) => {
      const currentStep = resolveCurrentStep(s.events.map(e => e.eventName));
      const customer = s.customer as unknown as CustomerHints | null;
      const cart = s.cart as unknown as { items?: Array<{ price: number; quantity: number }> } | null;

      const cartTotal = cart?.items?.reduce((sum, item) => sum + item.price * item.quantity, 0) ?? 0;
      const itemCount = cart?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

      return {
        sessionId: s.sessionId,
        currentStep,
        buyerHint: maskBuyerInfo(customer),
        updatedAt: s.updatedAt.toISOString(),
        cartTotal: Math.round(cartTotal * 100) / 100,
        itemCount,
      };
    });

    return {
      sessions: result,
      total: result.length,
    };
  }
}

function resolveCurrentStep(eventNames: string[]): string {
  let maxPriority = 1; // default = checkout_started
  let step = "checkout_started";

  for (const name of eventNames) {
    const priority = STEP_PRIORITY[name] ?? 0;
    if (priority > maxPriority) {
      maxPriority = priority;
      step = priorityToStepName(priority);
    }
  }

  return step;
}

function priorityToStepName(priority: number): string {
  switch (priority) {
    case 4: return "completed";
    case 3: return "payment";
    case 2: return "shipping";
    default: return "checkout_started";
  }
}

function maskBuyerInfo(customer: CustomerHints | null): string {
  if (!customer) return "Visitante";

  if (customer.email) {
    const [local, domain] = customer.email.split("@");
    if (local && domain) {
      return `${local[0]}***@${domain}`;
    }
  }

  if (customer.phone) {
    const digits = customer.phone.replace(/\D/g, "");
    if (digits.length >= 6) {
      return `${digits.slice(0, 2)}***${digits.slice(-3)}`;
    }
  }

  if (customer.fullName) {
    const parts = customer.fullName.split(" ");
    return parts[0] ?? "Visitante";
  }

  return "Visitante";
}
