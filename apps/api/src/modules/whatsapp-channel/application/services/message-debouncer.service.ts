/**
 * Message Debouncer — 5-second batch window per session.
 *
 * When buyer sends multiple messages quickly ("oi", "quero pizza", "calabresa"),
 * this accumulates them into a single processing unit instead of firing 3 times.
 *
 * Flow:
 * 1. First msg → start 5s timer
 * 2. More msgs within window → append to buffer
 * 3. Timer fires → concatenate all → emit for processing
 *
 * Injectable NestJS service.
 */

import { Injectable, Logger } from "@nestjs/common";

export interface DebouncedMessage {
  sessionId: string;
  merchantId: string;
  buyerPhone: string;
  messages: string[];
  combinedText: string;
  firstTimestamp: number;
}

type FlushCallback = (msg: DebouncedMessage) => void | Promise<void>;

interface BufferEntry {
  sessionId: string;
  merchantId: string;
  buyerPhone: string;
  messages: string[];
  firstTimestamp: number;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class MessageDebouncerService {
  private readonly logger = new Logger(MessageDebouncerService.name);
  private readonly buffers = new Map<string, BufferEntry>();
  private readonly WINDOW_MS = 5_000;
  private flushCallback: FlushCallback | null = null;

  /**
   * Register the callback invoked when debounce window closes.
   */
  onFlush(callback: FlushCallback): void {
    this.flushCallback = callback;
  }

  /**
   * Add a message to the session buffer.
   * If first message → starts the timer.
   * If buffer exists → appends.
   */
  push(sessionId: string, merchantId: string, buyerPhone: string, text: string): void {
    const existing = this.buffers.get(sessionId);

    if (existing) {
      existing.messages.push(text);
      this.logger.debug(
        `Buffered msg #${existing.messages.length} for session ${sessionId}`,
      );
      return;
    }

    const entry: BufferEntry = {
      sessionId,
      merchantId,
      buyerPhone,
      messages: [text],
      firstTimestamp: Date.now(),
      timer: setTimeout(() => this.flush(sessionId), this.WINDOW_MS),
    };

    this.buffers.set(sessionId, entry);
    this.logger.debug(`Debounce started for session ${sessionId} (${this.WINDOW_MS}ms window)`);
  }

  /**
   * Force-flush a session (for testing or shutdown).
   */
  forceFlush(sessionId: string): void {
    this.flush(sessionId);
  }

  /**
   * Flush all pending buffers (for graceful shutdown).
   */
  flushAll(): void {
    for (const sessionId of this.buffers.keys()) {
      this.flush(sessionId);
    }
  }

  private flush(sessionId: string): void {
    const entry = this.buffers.get(sessionId);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.buffers.delete(sessionId);

    const debounced: DebouncedMessage = {
      sessionId: entry.sessionId,
      merchantId: entry.merchantId,
      buyerPhone: entry.buyerPhone,
      messages: entry.messages,
      combinedText: entry.messages.join("\n"),
      firstTimestamp: entry.firstTimestamp,
    };

    this.logger.debug(
      `Flushing ${entry.messages.length} msg(s) for session ${sessionId}`,
    );

    if (this.flushCallback) {
      void Promise.resolve(this.flushCallback(debounced)).catch((err) => {
        this.logger.error(`Flush callback error for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  /**
   * Number of active debounce buffers (for monitoring).
   */
  get activeBuffers(): number {
    return this.buffers.size;
  }
}
