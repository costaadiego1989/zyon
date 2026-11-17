import { Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { whatsappE164 } from "../../../whatsapp-channel/domain/services/whatsapp-phone.js";

export type RecoveryResumeOrigin = { channel: "storefront" } | { channel: "whatsapp"; url: string };

/** Persisted channel ownership, never a caller-provided destination or channel. */
@Injectable()
export class RecoveryResumeOriginService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs?: WhatsAppConfigRepository) {}

  async resolve(session: CheckoutSession): Promise<RecoveryResumeOrigin> {
    const cartRef = (session.cart as { cart_ref?: unknown }).cart_ref;
    const refs = [...new Set([session.sessionId, session.conversationId, typeof cartRef === "string" ? cartRef : ""].filter(Boolean))];
    let whatsapp;
    try {
      whatsapp = await this.prisma.whatsAppSession.findFirst({
        where: { merchantId: session.merchantId, OR: [{ checkoutSessionId: session.sessionId },
          ...refs.map(ref => ({ conversationState: { path: ["conversationId"], equals: ref } }))] },
        orderBy: { lastActivityAt: "desc" },
      });
    } catch { throw new ServiceUnavailableException("recovery_origin_unavailable"); }
    if (!whatsapp) return { channel: "storefront" };
    const conversation = (whatsapp.conversationState as { conversationId?: unknown } | null)?.conversationId;
    if (whatsapp.merchantId !== session.merchantId || !(whatsapp.checkoutSessionId === session.sessionId
      || typeof conversation === "string" && refs.includes(conversation)) || !whatsapp.deviceId.startsWith("META_CLOUD:")) {
      throw new ServiceUnavailableException("recovery_whatsapp_connection_unavailable");
    }
    const configId = whatsapp.deviceId.slice("META_CLOUD:".length);
    const config = await this.configs?.findById(configId).catch(() => null);
    const phone = config?.whatsappNumber && whatsappE164(config.whatsappNumber);
    if (!config || config.id !== configId || !connectedMetaCloudCredentials(config, session.merchantId) || !phone) {
      throw new ServiceUnavailableException("recovery_whatsapp_connection_unavailable");
    }
    const url = new URL(`https://wa.me/${phone.slice(1)}`);
    url.searchParams.set("text", "Ver carrinho");
    return { channel: "whatsapp", url: url.href };
  }
}
