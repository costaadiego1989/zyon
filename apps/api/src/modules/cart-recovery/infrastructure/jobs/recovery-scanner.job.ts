import { Injectable, Inject, Logger, Optional, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";
import { PrismaCheckoutRepository } from "../../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import type { CheckoutSession } from "@zyon/shared-types";
import type { AttemptCartRecoveryUseCase } from "../../application/use-cases/attempt-cart-recovery.use-case.js";
import { ATTEMPT_CART_RECOVERY_USE_CASE } from "../../cart-recovery.tokens.js";
import { RECOVERY_ATTEMPT_REPOSITORY, type RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { STRATEGY_PREFERENCES_REPOSITORY, type StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import { BUYER_PURCHASE_HISTORY_REPOSITORY, type BuyerPurchaseHistoryRepository } from "../../../buyer-purchase-history/domain/ports/buyer-purchase-history-repository.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { RecoveryStrategy } from "../../domain/values/recovery-strategy.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";

// Recovery is promised after five minutes of real inactivity. Scan once a
// minute so a qualified cart is dispatched within about one minute of that
// threshold, rather than waiting for a fifteen-minute polling window.
const SCAN_INTERVAL_MS = 60 * 1000;
const QUIET_PERIOD_MS = 5 * 60 * 1000;

/**
 * RecoveryScannerJob
 *
 * Runs every minute: loads candidate sessions and delegates attempts to the
 * module's shared recovery use case, including connection/template routing.
 * Delivery is revalidated against the current checkout, order and payment
 * state immediately before delegating to the channel router.
 */
@Injectable()
export class RecoveryScannerJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoveryScannerJob.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private initialHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(RECOVERY_ATTEMPT_REPOSITORY) private readonly attempts: RecoveryAttemptRepositoryPort,
    @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRules: MerchantRulesRepository,
    @Inject(STRATEGY_PREFERENCES_REPOSITORY) private readonly strategyPrefs: StrategyPreferencesRepositoryPort,
    @Inject(BUYER_PURCHASE_HISTORY_REPOSITORY) private readonly purchaseHistory: BuyerPurchaseHistoryRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(ATTEMPT_CART_RECOVERY_USE_CASE) private readonly attemptRecovery: Pick<AttemptCartRecoveryUseCase, "execute">,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyerAccount?: BuyerAccountRepository,
  ) {}

  /**
   * Start the interval on module init (NestJS lifecycle hook).
   * Runs every minute.
   */
  onModuleInit(): void {
    this.start();
  }

  /**
   * Starts the scanner once.  The API bootstrap resolves this provider as a
   * production liveness guard, while Nest lifecycle initialization remains a
   * supported startup path for tests and local development.
   */
  start(): void {
    if (this.intervalHandle || this.initialHandle) return;
    // Run an initial scan shortly after boot so recovery doesn't wait a full
    // interval after a restart, then schedule the recurring scan.
    this.initialHandle = setTimeout(() => {
      this.initialHandle = null;
      this.scan().catch((err) => {
        this.logger.error("recovery-scanner: initial scan failed", { error: err instanceof Error ? err.message : String(err) });
      });
    }, 5_000);
    this.intervalHandle = setInterval(() => {
      this.scan().catch((err) => {
        this.logger.error(
          "recovery-scanner: unhandled error in scheduled scan",
          { error: err instanceof Error ? err.message : String(err) }
        );
      });
    }, SCAN_INTERVAL_MS);
    this.logger.log("recovery-scanner: scheduled for every minute (initial scan in 5s)", { intervalMs: SCAN_INTERVAL_MS });
  }

  /**
   * Clean up interval on module destroy (NestJS lifecycle hook).
   */
  onModuleDestroy(): void {
    if (this.initialHandle) {
      clearTimeout(this.initialHandle);
      this.initialHandle = null;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log("recovery-scanner: interval cleared");
    }
  }

  /**
   * Main scan loop. Called by job scheduler every minute.
   * Isolated: each session is processed independently; failures are logged, not fatal.
   * Multi-instance safety: use a short random jitter to minimize collision probability.
   */
  async scan(): Promise<{ scanned: number; attempted: number; errors: number }> {
    // Apply a short jitter to minimize multi-instance collisions without
    // turning the five-minute recovery promise into a multi-minute delay.
    const jitter = Math.random() * 5 * 1000;
    await new Promise(resolve => setTimeout(resolve, jitter));

    const stats = { scanned: 0, attempted: 0, errors: 0 };

    try {
      try { await this.qualifyIdleWhatsAppSessions(); }
      catch (error) {
        this.logger.warn("recovery-scanner: WhatsApp idle lookup unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // Query sessions with triggerAgent=true
      const candidates = await this.sessions.findSessionsWithTrigger();
      stats.scanned = candidates.length;

      // Keep the asynchronous recovery path observable in production without
      // exposing contact or cart data.  A scan with no candidates is expected
      // most of the time, but recording it at debug level makes it possible to
      // distinguish an empty queue from a scheduler that never ran.
      this.logger.debug("recovery-scanner: scan completed", {
        candidates: stats.scanned,
      });

      for (const session of candidates) {
        try {
          await this.processSession(session);
          stats.attempted++;
        } catch (err) {
          stats.errors++;
          this.logger.error(
            `recovery-scanner: failed to process session`,
            {
              merchantId: session.merchantId,
              sessionId: session.sessionId,
              error: err instanceof Error ? err.message : String(err)
            }
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `recovery-scanner: query failed`,
        { error: err instanceof Error ? err.message : String(err) }
      );
    }

    return stats;
  }

  /** The official channel has no browser timer. Measure its scoped persisted
   * activity before using the existing checkout scoring and recovery gates. */
  private async qualifyIdleWhatsAppSessions(): Promise<void> {
    if (!this.prisma.whatsAppSession?.findUnique || !this.prisma.$transaction) return;
    const now = Date.now(), earliest = new Date(now - 72 * 60 * 60 * 1000), latest = new Date(now - 10_000);
    const candidates = await this.prisma.$queryRaw<Array<{ id: string; merchantId: string; sessionId: string }>>(Prisma.sql`
      SELECT w.id, w.merchant_id AS "merchantId", c.session_id AS "sessionId"
      FROM whatsapp_sessions w JOIN checkout_sessions c
        ON c.merchant_id = w.merchant_id AND c.session_id = COALESCE(w.checkout_session_id,
          CASE WHEN jsonb_typeof(w.conversation_state->'conversationId') = 'string'
            THEN w.conversation_state->>'conversationId' END)
      LEFT JOIN checkout_settings settings ON settings.merchant_id = w.merchant_id
      CROSS JOIN LATERAL (SELECT CASE
        WHEN jsonb_typeof(settings.intervention_policy->'idleSeconds') = 'number'
          THEN (settings.intervention_policy->>'idleSeconds')::numeric ELSE 180 END AS seconds) idle
      WHERE w.status = 'active' AND left(w.device_id, 11) = 'META_CLOUD:'
        AND w.last_activity_at BETWEEN ${earliest} AND ${latest}
        AND c.updated_at BETWEEN ${earliest} AND ${latest} AND c.trigger_agent = false
        AND GREATEST(w.last_activity_at, c.updated_at) <= ${new Date(now)}::timestamp -
          (CASE WHEN idle.seconds BETWEEN 10 AND 3600 AND idle.seconds = trunc(idle.seconds)
            THEN idle.seconds ELSE 180 END) * INTERVAL '1 second'
        AND CASE WHEN jsonb_typeof(c.cart->'items') = 'array'
          THEN jsonb_array_length(c.cart->'items') > 0 ELSE false END
        AND (w.checkout_session_id IS NOT NULL OR EXISTS (
          SELECT 1 FROM storefront_carts s WHERE s.merchant_id = w.merchant_id AND s.session_id = c.session_id
            AND s.expires_at > ${new Date(now)} AND CASE WHEN jsonb_typeof(s.items) = 'array'
              THEN jsonb_array_length(s.items) > 0 ELSE false END))
        AND NOT EXISTS (SELECT 1 FROM completed_orders o WHERE o.merchant_id = c.merchant_id AND o.session_id = c.session_id)
        AND NOT EXISTS (SELECT 1 FROM payment_intents p WHERE p.merchant_id = c.merchant_id
          AND p.session_id = c.session_id AND p.status = 'approved')
        AND NOT EXISTS (SELECT 1 FROM whatsapp_webhook_inbox i WHERE i.merchant_id = w.merchant_id
          AND i.status IN ('pending', 'processing', 'blocked')
          AND i.stream_key = encode(sha256(convert_to(
            '[' || to_json(w.merchant_id)::text || ',' || to_json(substring(w.device_id FROM 12))::text ||
            ',"message",' || to_json(regexp_replace(w.buyer_phone, '[^0-9]', '', 'g'))::text || ']', 'UTF8')), 'hex'))
      ORDER BY w.last_activity_at ASC, w.id ASC LIMIT 100
    `);
    for (const candidate of candidates) {
      try {
        await this.prisma.$transaction(async tx => {
          await lockCheckoutSessionAnchor(tx, candidate.merchantId, candidate.sessionId);
          await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${candidate.merchantId}
            AND session_id = ${candidate.sessionId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM whatsapp_sessions WHERE id = ${candidate.id}
            AND merchant_id = ${candidate.merchantId} FOR UPDATE`;
          const whatsapp = await tx.whatsAppSession.findUnique({ where: { id: candidate.id } });
          if (!whatsapp || whatsapp.merchantId !== candidate.merchantId || whatsapp.status !== "active"
            || this.whatsAppRecoverySessionId(whatsapp) !== candidate.sessionId) return;
          if (!whatsapp.checkoutSessionId && !await this.hasShoppingCart(tx, whatsapp.merchantId, candidate.sessionId)) return;
          const session = await tx.checkoutSession.findUnique({ where: {
            merchantId_sessionId: { merchantId: candidate.merchantId, sessionId: candidate.sessionId },
          } });
          if (!session || session.triggerAgent || !Number.isFinite(session.abandonmentScore)) return;
          const items = (session.cart as { items?: unknown[] } | null)?.items;
          if (!Array.isArray(items) || items.length === 0) return;
          const lastActivity = Math.max(whatsapp.lastActivityAt.getTime(), session.updatedAt.getTime());
          const setting = await tx.checkoutSetting.findUnique({ where: { merchantId: candidate.merchantId }, select: { interventionPolicy: true } });
          if (Date.now() - lastActivity < this.idleSeconds(setting?.interventionPolicy) * 1000) return;
          const scope = { merchantId: candidate.merchantId, sessionId: candidate.sessionId };
          if (await tx.completedOrder.findFirst({ where: scope, select: { id: true } })
            || await tx.paymentIntent.findFirst({ where: { ...scope, status: "approved" }, select: { id: true } })
            || await this.hasPendingWhatsAppInput(tx, whatsapp)) return;
          // Reuse the transactional scorer. Idle telemetry preserves the real
          // activity timestamp and cannot itself authorize delivery or an offer.
          await new PrismaCheckoutRepository(tx, true).recordEvent(candidate.merchantId, candidate.sessionId, "idle_30_seconds", {
            source: "whatsapp_idle", whatsappSessionId: whatsapp.id, lastBuyerActivityAt: new Date(lastActivity).toISOString(),
          });
        });
      } catch (error) {
        this.logger.warn("recovery-scanner: WhatsApp idle measurement failed", {
          merchantId: candidate.merchantId, sessionId: candidate.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private idleSeconds(policy: unknown): number {
    const value = (policy as { idleSeconds?: unknown } | null)?.idleSeconds;
    return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 3600 ? value : 180;
  }

  private whatsAppRecoverySessionId(whatsapp: { checkoutSessionId?: string | null; deviceId: string; conversationState?: unknown }): string | undefined {
    if (whatsapp.checkoutSessionId) return whatsapp.checkoutSessionId;
    const conversationId = (whatsapp.conversationState as { conversationId?: unknown } | null)?.conversationId;
    return whatsapp.deviceId.startsWith("META_CLOUD:") && typeof conversationId === "string" && conversationId.trim()
      ? conversationId : undefined;
  }

  private async hasShoppingCart(db: Pick<Prisma.TransactionClient, "storefrontCart">, merchantId: string, sessionId: string): Promise<boolean> {
    const cart = await db.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } }, select: { items: true, expiresAt: true } });
    return !!cart && cart.expiresAt.getTime() > Date.now() && Array.isArray(cart.items) && cart.items.length > 0;
  }

  private async hasPendingWhatsAppInput(db: Pick<Prisma.TransactionClient, "whatsAppWebhookInbox">,
    whatsapp: { merchantId: string; deviceId: string; buyerPhone: string }): Promise<boolean> {
    const streamKey = createHash("sha256").update(JSON.stringify([
      whatsapp.merchantId, whatsapp.deviceId.slice(11), "message", whatsapp.buyerPhone.replace(/\D/g, ""),
    ])).digest("hex");
    return !!await db.whatsAppWebhookInbox.findFirst({ where: { merchantId: whatsapp.merchantId, streamKey,
      status: { in: ["pending", "processing", "blocked"] } }, select: { id: true } });
  }

  private async processSession(session: CheckoutSession): Promise<void> {
    // Dedup: skip if attempt already exists for this session
    const existingAttempt = await this.attempts.existsForSession(session.merchantId, session.sessionId);
    if (existingAttempt) {
      this.logger.debug(`recovery-scanner: attempt already exists`, {
        merchantId: session.merchantId,
        sessionId: session.sessionId
      });
      return;
    }

    // Threshold check
    const MINIMUM_SCORE = 0.55;
    if (session.abandonmentScore < MINIMUM_SCORE) {
      this.logger.debug("recovery-scanner: abandonment score below threshold", {
        merchantId: session.merchantId,
        sessionId: session.sessionId,
      });
      return;
    }

    // Load buyer history for strategy selection
    const globalUserId = session.globalUserId;
    if (!globalUserId) {
      this.logger.warn(
        `recovery-scanner: session missing globalUserId`,
        { merchantId: session.merchantId, sessionId: session.sessionId }
      );
      return;
    }

    // Fix #4: Load real buyer purchase history (known_buyer, discount sensitivity, recent SKUs).
    let buyerHistoryContext = {
      known_buyer: false,
      discount_sensitivity: "low" as "low" | "medium" | "high",
      recent_skus: [] as string[],
    };
    try {
      const history = await this.purchaseHistory.getContext({ globalUserId, merchantId: session.merchantId });
      if (history) {
        const ctx = history.purchase_history;
        buyerHistoryContext = {
          known_buyer: ctx.known_buyer,
          // Strategy selector only knows low/medium/high — map "unknown" → "low".
          discount_sensitivity: ctx.discount_sensitivity === "unknown" ? "low" : ctx.discount_sensitivity,
          recent_skus: ctx.recent_skus,
        };
      }
    } catch (err) {
      this.logger.warn("recovery-scanner: buyer history lookup failed (using defaults)", { error: err instanceof Error ? err.message : String(err) });
    }

    const merchantPolicy = await this.merchantRules.getRules(session.merchantId);
    if (!merchantPolicy) {
      this.logger.warn(
        `recovery-scanner: merchant policy not found`,
        { merchantId: session.merchantId }
      );
      return;
    }

    // Fix #2: Classify reason from the session's real recorded checkout events.
    let eventNames: string[] = [];
    try {
      const rows: Array<{ eventName: string }> = await this.prisma.checkoutEvent.findMany({
        where: { merchantId: session.merchantId, sessionId: session.sessionId },
        orderBy: { occurredAt: "asc" },
        select: { eventName: true },
      });
      eventNames = rows.map((r) => r.eventName);
    } catch (err) {
      this.logger.warn("recovery-scanner: event lookup failed", { error: err instanceof Error ? err.message : String(err) });
    }
    if (eventNames.length === 0) {
      this.logger.debug("recovery-scanner: no measured session events; skipping", {
        merchantId: session.merchantId,
        sessionId: session.sessionId,
      });
      return;
    }

    // Fix #7: Honor the merchant's dashboard-configured strategy override.
    let forcedStrategy: RecoveryStrategy | undefined;
    try {
      const cfg = await this.strategyPrefs.getConfig(session.merchantId);
      forcedStrategy = this.buildForcedStrategy(cfg, buyerHistoryContext.recent_skus);
    } catch (error) {
      this.logger.warn("recovery-scanner: strategy configuration unavailable", { merchantId: session.merchantId });
      return;
    }
    if (forcedStrategy?.type === "no_action") {
      this.logger.debug("recovery-scanner: configured strategy cannot dispatch", {
        merchantId: session.merchantId,
        sessionId: session.sessionId,
      });
      return;
    }
    if (forcedStrategy?.type === "offer_free_shipping" && !merchantPolicy.allowFreeShipping) {
      this.logger.debug("recovery-scanner: free shipping strategy disabled by merchant policy", {
        merchantId: session.merchantId,
        sessionId: session.sessionId,
      });
      return;
    }

    // The shared router selects WhatsApp or email from the available contacts.
    let buyerPhone: string | undefined;
    let buyerEmail: string | undefined;
    let buyerName: string | undefined;
    if (this.buyerAccount) {
      try {
        const account = await this.buyerAccount.findByGlobalUserId(globalUserId);
        buyerPhone = account?.phone || undefined;
        buyerEmail = account?.email || undefined;
        buyerName = account?.displayName || undefined;
      } catch { /* contact optional */ }
    }

    // Resolve store name for the approved-template/email routing request.
    let merchantName: string | undefined;
    try {
      const m = await this.prisma.merchant.findUnique({
        where: { id: session.merchantId },
        select: { name: true },
      });
      merchantName = m?.name || undefined;
    } catch { /* name optional */ }

    // Re-read authoritative state immediately before any channel routing. A
    // score created earlier must never override a resumed session, a completed
    // order, an approved payment, or an empty cart.
    if (!await this.isStillEligible(session)) return;

    // Reuse the module's composition, including connection/template checks.
    const result = await this.attemptRecovery.execute({
      merchantId: session.merchantId,
      sessionId: session.sessionId,
      globalUserId,
      abandonmentScore: session.abandonmentScore,
      events: eventNames,
      buyerHistory: buyerHistoryContext,
      merchantRules: {
        allowFreeShipping: merchantPolicy.allowFreeShipping,
        maxDiscountPercent: merchantPolicy.maxDiscountPercent
      },
      forcedStrategy,
      buyerPhone,
      buyerEmail,
      buyerName,
      merchantName,
    });

    if (!result.created) {
      this.logger.debug("recovery-scanner: recovery attempt not created", {
        merchantId: session.merchantId,
        sessionId: session.sessionId,
      });
      return;
    }

    this.logger.log(
      `recovery-scanner: attempt created`,
      {
        merchantId: session.merchantId,
        sessionId: session.sessionId,
        attemptId: result.attemptId,
        forced: !!forcedStrategy,
        events: eventNames,
      }
    );
  }

  private async isStillEligible(scanned: CheckoutSession): Promise<boolean> {
    const current = await this.sessions.getSession(scanned.merchantId, scanned.sessionId);
    if (!current) return false;
    const items = (current.cart as { items?: unknown[] } | null | undefined)?.items;
    if (!Array.isArray(items) || items.length === 0) {
      this.logger.debug("recovery-scanner: cart is empty at dispatch", { merchantId: current.merchantId, sessionId: current.sessionId });
      return false;
    }
    const updatedAt = new Date(current.updatedAt).getTime();
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < QUIET_PERIOD_MS) {
      this.logger.debug("recovery-scanner: checkout is still active", { merchantId: current.merchantId, sessionId: current.sessionId });
      return false;
    }
    try {
      // Shopping telemetry and the checkout can both remain qualified. Once
      // checkout binds a cart, only its newest durable owner may recover it.
      const storedCartRef = (current.cart as { cart_ref?: unknown }).cart_ref;
      const cartRef = typeof storedCartRef === "string" && storedCartRef.trim() ? storedCartRef
        : current.sessionId === current.conversationId ? current.sessionId : undefined;
      if (cartRef) {
        const owner = await this.prisma.checkoutSession.findFirst({
          where: { merchantId: current.merchantId, cart: { path: ["cart_ref"], equals: cartRef } },
          orderBy: [{ createdAt: "desc" }, { sessionId: "desc" }], select: { sessionId: true },
        });
        if (owner && owner.sessionId !== current.sessionId) return false;
      }
      let whatsapp = await this.prisma.whatsAppSession?.findFirst?.({
        where: { merchantId: current.merchantId, checkoutSessionId: current.sessionId }, orderBy: { lastActivityAt: "desc" },
      });
      whatsapp ??= await this.prisma.whatsAppSession?.findFirst?.({
        where: { merchantId: current.merchantId, deviceId: { startsWith: "META_CLOUD:" },
          conversationState: { path: ["conversationId"], equals: current.sessionId } }, orderBy: { lastActivityAt: "desc" },
      });
      if (whatsapp) {
        if (this.whatsAppRecoverySessionId(whatsapp) !== current.sessionId) return false;
        if (!whatsapp.checkoutSessionId && !await this.hasShoppingCart(this.prisma, current.merchantId, current.sessionId)) return false;
        const setting = await this.prisma.checkoutSetting.findUnique({ where: { merchantId: current.merchantId }, select: { interventionPolicy: true } });
        if (whatsapp.status !== "active" || Date.now() - whatsapp.lastActivityAt.getTime()
          < Math.max(QUIET_PERIOD_MS, this.idleSeconds(setting?.interventionPolicy) * 1000)) return false;
        if (whatsapp.deviceId.startsWith("META_CLOUD:") && await this.hasPendingWhatsAppInput(this.prisma, whatsapp)) return false;
      }
      const completed = await (this.prisma as any).completedOrder?.findFirst?.({
        where: { merchantId: current.merchantId, sessionId: current.sessionId },
        select: { id: true },
      });
      if (completed) {
        this.logger.debug("recovery-scanner: order already completed", { merchantId: current.merchantId, sessionId: current.sessionId });
        return false;
      }
      const approvedPayment = await (this.prisma as any).paymentIntent?.findFirst?.({
        where: { merchantId: current.merchantId, sessionId: current.sessionId, status: "approved" },
        select: { id: true },
      });
      if (approvedPayment) {
        this.logger.debug("recovery-scanner: payment already approved", { merchantId: current.merchantId, sessionId: current.sessionId });
        return false;
      }
    } catch (error) {
      // A failed authority lookup cannot be treated as permission to contact.
      this.logger.warn("recovery-scanner: dispatch eligibility unavailable", {
        merchantId: current.merchantId,
        sessionId: current.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    return true;
  }

  /**
   * Map the merchant's dashboard strategy config to a concrete RecoveryStrategy.
   * Incomplete configuration pauses this candidate. Never replace the
   * merchant's selection with an unrelated automatic strategy.
   */
  private buildForcedStrategy(
    cfg: { active_strategy?: string; coupon_code?: string; rule_id?: string } | null,
    recentSkus: string[],
  ): RecoveryStrategy | undefined {
    const unavailable: RecoveryStrategy = { type: "no_action", reason: "strategy_not_configured" };
    if (!cfg?.active_strategy) return unavailable;
    switch (cfg.active_strategy) {
      case "offer_free_shipping":
        return { type: "offer_free_shipping", condition: "merchant_allows_free_shipping" };
      case "offer_coupon":
        return cfg.coupon_code
          ? { type: "offer_coupon", coupon_code: cfg.coupon_code }
          : unavailable;
      case "personalized_cross_sell":
        return { type: "personalized_cross_sell", suggested_skus: recentSkus };
      case "advanced_rule":
        return cfg.rule_id
          ? { type: "advanced_rule", rule_id: cfg.rule_id }
          : unavailable;
      default:
        return unavailable;
    }
  }
}
