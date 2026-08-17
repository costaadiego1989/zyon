import { Inject, Injectable, BadRequestException } from "@nestjs/common";
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
}

@Injectable()
export class CreateBudgetRequestUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: CreateBudgetRequestInput): Promise<BudgetRequestDto> {
    if (!input.merchantId || !input.customerName || !input.customerEmail || !input.customerPhone) {
      throw new BadRequestException("missing_required_fields");
    }
    if (!input.items?.length) {
      throw new BadRequestException("items_required");
    }

    const budget = await this.prisma.budgetRequest.create({
      data: {
        merchantId: input.merchantId,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone.replace(/\D/g, ""),
        items: input.items as any,
        subtotal: input.total,
        total: input.total,
        note: input.note ?? null,
        status: "pending",
      },
    });

    void this.notifyMerchant(input.merchantId, budget.id, input);

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

  private async notifyMerchant(merchantId: string, budgetId: string, input: CreateBudgetRequestInput) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { name: true, budgetEmail: true, budgetWhatsapp: true, storeSettings: true },
    });
    if (!merchant) return;

    const email = merchant.budgetEmail ?? (merchant.storeSettings as any)?.company?.email;
    const phone = merchant.budgetWhatsapp ?? (merchant.storeSettings as any)?.company?.phone;
    const itemsText = input.items.map((i) => `• ${i.productName} x${i.quantity} — R$ ${i.price.toFixed(2)}`).join("\n");
    const totalText = `R$ ${input.total.toFixed(2)}`;

    if (phone) {
      const waText = encodeURIComponent(
        `Novo orçamento de ${input.customerName}!\n${input.items.length} items — ${totalText}\nEmail: ${input.customerEmail}\nTel: ${input.customerPhone}`
      );
      console.log(`[Budget] WhatsApp: https://wa.me/${phone.replace(/\D/g, "")}?text=${waText}`);
    }

    if (email) {
      console.log(`[Budget] Email → ${email}: Novo orçamento de ${input.customerName} — ${totalText}`);
    }
  }
}
