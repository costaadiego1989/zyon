/**
 * Twilio Message Deduplicator — prevents processing duplicate webhooks.
 *
 * Twilio may retry webhooks. We deduplicate by (provider, messageSid).
 * Uses in-memory Set with TTL cleanup (5 minutes).
 */

import { Injectable, Logger } from "@nestjs/common";

interface DedupeKey {
  provider: string;
  messageSid: string;
}

@Injectable()
export class TwilioDeduplicatorService {
  private readonly logger = new Logger(TwilioDeduplicatorService.name);
  private readonly processedMessages = new Map<string, number>(); // key -> timestamp
  private readonly ttlMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Check if message was already processed.
   * @returns true if duplicate, false if unique
   */
  isDuplicate(provider: string, messageSid: string): boolean {
    const key = `${provider}:${messageSid}`;
    const lastSeen = this.processedMessages.get(key);

    if (lastSeen && Date.now() - lastSeen < this.ttlMs) {
      this.logger.debug(`Duplicate ${provider} message: ${messageSid}`);
      return true;
    }

    return false;
  }

  /**
   * Mark message as processed.
   */
  mark(provider: string, messageSid: string): void {
    const key = `${provider}:${messageSid}`;
    this.processedMessages.set(key, Date.now());
  }

  /**
   * Cleanup expired entries (called periodically).
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.ttlMs) {
        this.processedMessages.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} expired dedup entries`);
    }
  }
}
