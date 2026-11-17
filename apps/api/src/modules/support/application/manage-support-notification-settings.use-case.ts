import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { parseSupportNotificationRecipient, type SupportNotificationSettings } from "../domain/support-notification-settings.js";

const selection = { fallbackWhatsapp: true, version: true, updatedAt: true } as const;
type StoredSettings = { fallbackWhatsapp: string | null; version: number; updatedAt: Date };
const present = (row: StoredSettings | null): SupportNotificationSettings => ({
  channel: "whatsapp", fallbackPhone: row?.fallbackWhatsapp ?? null,
  version: row?.version ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null,
});

@Injectable()
export class ManageSupportNotificationSettingsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly tenant: TenantContextService) {}

  async get(merchantId: string): Promise<SupportNotificationSettings> {
    this.assertScope(merchantId);
    return present(await this.prisma.supportNotificationSetting.findUnique({ where: { merchantId }, select: selection }));
  }

  async save(merchantId: string, input: unknown): Promise<SupportNotificationSettings> {
    this.assertScope(merchantId);
    const fallbackWhatsapp = parseSupportNotificationRecipient(input);
    return this.prisma.$transaction(async tx => {
      // Serialize even the first configuration without updating merchant/FAQ
      // timestamps or involving public source writers.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      if (rows.length !== 1) throw new NotFoundException("support_notification_merchant_not_found");
      const current = await tx.supportNotificationSetting.findUnique({ where: { merchantId }, select: selection });
      if (current && current.fallbackWhatsapp === fallbackWhatsapp) return present(current);
      const saved = current
        ? await tx.supportNotificationSetting.update({ where: { merchantId },
          data: { fallbackWhatsapp, version: { increment: 1 } }, select: selection })
        : await tx.supportNotificationSetting.create({ data: { merchantId, fallbackWhatsapp }, select: selection });
      return present(saved);
    });
  }

  private assertScope(merchantId: string): void {
    if (!merchantId || this.tenant.get()?.merchantId !== merchantId) throw new ForbiddenException("support_notification_scope_mismatch");
  }
}
