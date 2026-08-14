/**
 * DNS verification service.
 * Uses Node.js dns.promises to verify CNAME records.
 */

import { Injectable, Logger } from "@nestjs/common";
import { promises as dns } from "dns";

@Injectable()
export class DnsVerificationService {
  private readonly logger = new Logger(DnsVerificationService.name);

  /**
   * Verify that a domain has a CNAME pointing to the expected target.
   */
  async verifyCname(domain: string, expectedTarget: string): Promise<boolean> {
    try {
      const records = await dns.resolveCname(domain);
      const normalized = records.map((r) => r.replace(/\.$/, "").toLowerCase());
      const target = expectedTarget.replace(/\.$/, "").toLowerCase();

      const verified = normalized.includes(target);
      if (verified) {
        this.logger.log(`Domain ${domain} verified: CNAME → ${target}`);
      } else {
        this.logger.debug(
          `Domain ${domain} CNAME mismatch. Expected: ${target}, Got: ${normalized.join(", ")}`,
        );
      }
      return verified;
    } catch (error) {
      this.logger.debug(
        `DNS lookup failed for ${domain}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
