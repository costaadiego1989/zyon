import { Inject, Injectable, Logger } from "@nestjs/common";
import type { WhatsAppOutboundMessage, WhatsAppSenderPort, WhatsAppSendResult } from "../../domain/ports/whatsapp-sender.port.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../domain/services/connected-meta-cloud-credentials.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";

@Injectable()
export class MetaCloudSenderAdapter implements WhatsAppSenderPort {
  private readonly logger = new Logger(MetaCloudSenderAdapter.name);
  private readonly graph = "https://graph.facebook.com/v23.0";

  constructor(@Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo: WhatsAppConfigRepository) {}

  async sendText(msg: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    const config = await this.findConfig(msg.deviceId);
    const credentials = config && connectedMetaCloudCredentials(config, config.merchantId);
    const recipient = whatsappE164(msg.toNumber);
    if (!credentials || !recipient) return { messageId: "", status: "failed" };
    try {
      const response = await fetch(`${this.graph}/${credentials.phoneNumberId}/messages`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: recipient.slice(1), type: "text", text: { body: msg.text } }),
      });
      if (!response.ok) {
        this.logger.error(`Meta Cloud text send failed: HTTP ${response.status}`);
        return { messageId: "", status: "failed" };
      }
      const payload = await response.json().catch(() => ({})) as { messages?: Array<{ id?: unknown }> };
      const messageId = typeof payload.messages?.[0]?.id === "string" ? payload.messages[0].id : "";
      return messageId ? { messageId, status: "sent" } : { messageId: "", status: "failed" };
    } catch {
      this.logger.error("Meta Cloud text transport failed");
      return { messageId: "", status: "failed" };
    }
  }

  async sendMedia(msg: WhatsAppOutboundMessage & { mediaUrl: string; mimetype: string }): Promise<WhatsAppSendResult> {
    return this.sendText(msg);
  }

  private async findConfig(deviceId: string) {
    if (deviceId.startsWith("META_CLOUD:")) return this.configRepo.findById(deviceId.slice("META_CLOUD:".length));
    return this.configRepo.findByDeviceId(deviceId);
  }
}
