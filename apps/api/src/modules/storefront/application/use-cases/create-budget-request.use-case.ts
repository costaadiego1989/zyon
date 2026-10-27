import { Inject, Injectable, BadRequestException, ForbiddenException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface CreateBudgetRequestInput {
  merchantId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: Array<{ variantId: string; productName: string; quantity: number; price: number }>;
  total: number;
  note?: string;
}

export interface BudgetRequestDto {
  id: string;
  merchantId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: unknown;
  total: number;
  note: string | null;
  status: string;
  createdAt: string;
  deliveries?: Array<{ channel: string; status: string; attempts: number; lastError: string | null; providerMessageId: string | null; updatedAt: string }>;
}

@Injectable()
export class CreateBudgetRequestUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: CreateBudgetRequestInput): Promise<BudgetRequestDto> {
    if (!input.merchantId || typeof input.customerName !== "string" || !input.customerName.trim() || input.customerName.length > 200 || typeof input.customerEmail !== "string" || input.customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail.trim()) || typeof input.customerPhone !== "string" || !/^\d{10,15}$/.test(input.customerPhone.replace(/\D/g, ""))) {
      throw new BadRequestException("missing_required_fields");
    }
    if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 2000)) throw new BadRequestException("invalid_budget_note");
    const merchant = await this.prisma.merchant.findUnique({ where: { id: input.merchantId }, select: { budgetModeEnabled: true } });
    if (!merchant?.budgetModeEnabled) throw new ForbiddenException("budget_mode_disabled");
    if (!input.items?.length || input.items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price) || item.price < 0) || !Number.isFinite(input.total) || input.total < 0) {
      throw new BadRequestException("items_required");
    }

    const budget = await this.prisma.$transaction(async (tx) => {
      const created = await tx.budgetRequest.create({
        data: {
          merchantId: input.merchantId,
          customerName: input.customerName.trim(),
          customerEmail: input.customerEmail.trim(),
          customerPhone: input.customerPhone.replace(/\D/g, ""),
          items: input.items as any,
          subtotal: input.items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0) / 100,
          total: input.total,
          note: input.note ?? null,
          status: "pending",
        },
      });

      await tx.merchantNotification.create({ data: {
        merchantId: input.merchantId,
        type: "budget_request",
        title: "Nova solicitação de orçamento",
        body: "Uma solicitação foi recebida. Confira os itens e dados de contato na aba Orçamento em Configurações da Loja.",
        metadata: { budgetId: created.id, href: "#store-settings" },
      } });
      await tx.budgetRequestNotificationDelivery.createMany({
        data: ["email", "whatsapp"].map((channel) => ({ budgetRequestId: created.id, channel })),
      });
      return created;
    });

    return {
      id: budget.id,
      merchantId: budget.merchantId,
      customerName: budget.customerName,
      customerEmail: budget.customerEmail,
      customerPhone: budget.customerPhone,
      items: budget.items,
      total: budget.total,
      note: budget.note,
      status: budget.status,
      createdAt: budget.createdAt.toISOString(),
    };
  }
}
