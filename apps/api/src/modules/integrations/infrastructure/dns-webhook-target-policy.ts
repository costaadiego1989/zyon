import { BadRequestException, Injectable } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import type { WebhookTargetPolicy } from "../domain/ports/webhook-target-policy.port.js";

@Injectable()
export class DnsWebhookTargetPolicy implements WebhookTargetPolicy {
  async assertAllowed(rawUrl: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException("invalid_webhook_url");
    }
    if (url.username || url.password || url.protocol !== "https:") {
      throw new BadRequestException("webhook_url_must_be_https");
    }
    if (url.port && url.port !== "443") {
      throw new BadRequestException("webhook_port_not_allowed");
    }
    if (ipaddr.isValid(url.hostname)) {
      assertPublicAddress(url.hostname);
      return url.toString();
    }

    let addresses: Array<{ address: string }>;
    try {
      addresses = await lookup(url.hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException("webhook_dns_resolution_failed");
    }
    if (addresses.length === 0) {
      throw new BadRequestException("webhook_dns_resolution_failed");
    }
    for (const resolved of addresses) {
      assertPublicAddress(resolved.address);
    }
    return url.toString();
  }
}

function assertPublicAddress(value: string): void {
  const address = ipaddr.process(value);
  if (address.range() !== "unicast") {
    throw new BadRequestException("webhook_private_network_forbidden");
  }
}
