import { Inject, Injectable } from "@nestjs/common";
import { BillingPlanMeteringService } from "../../payment/domain/billing-plan-guard.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { BuyerAgentProfile } from "../../buyer-account/domain/entities/buyer-agent-profile.entity.js";
import { SHOPPING_COMMERCE, type ShoppingCommerce } from "./shopping-commerce.service.js";
import { SHOPPING_REPOSITORY, ShoppingError, fingerprint, freshState, newId, nextCheck, nextCycle, validateConfig, validateSettings,
  type ShoppingRepository, type ShoppingState, type Workspace, type ShoppingTask, type ShoppingActivity } from "../domain/shopping-agent.js";

@Injectable()
export class ShoppingAgentService {
  constructor(
    @Inject(SHOPPING_REPOSITORY) readonly repo: ShoppingRepository,
    @Inject(SHOPPING_COMMERCE) readonly commerce: ShoppingCommerce,
    readonly billing: BillingPlanMeteringService,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository,
  ) {}
  async allowed(merchantId: string): Promise<boolean> {
    try { await this.billing.assertAllowed(merchantId, { kind: "feature", key: "personalShoppingAgent" }); return true; }
    catch (error) { if ((error as { getStatus?: () => number }).getStatus?.() === 403) return false; throw error; }
  }
  async requirePlan(merchantId: string): Promise<void> {
    if (!await this.allowed(merchantId)) throw new ShoppingError("agent_premium_required", 403);
  }
  async get(buyerId: string, merchantId: string) {
    const [workspace, profile, premium] = await Promise.all([this.repo.find(buyerId, merchantId), this.accounts.findAgentByGlobalUserId(buyerId), this.allowed(merchantId)]);
    return { premium, profile: profile ? { name: profile.name, personality: profile.personality } : null,
      state: workspace?.state ?? null, capabilities: { automaticPayments: false, scope: "this_store", maxActiveTasks: 25 } };
  }
  async configure(buyerId: string, merchantId: string, input: unknown) {
    const current = await this.repo.find(buyerId, merchantId);
    // Revocation and notification opt-out remain available after a downgrade.
    const raw = input as Record<string, unknown>;
    const settings = validateSettings(input, current?.state.settings);
    if (!current || raw.appearance !== undefined || settings.enabled && !current.state.settings.enabled || settings.email && !current.state.settings.email || settings.whatsapp && !current.state.settings.whatsapp) await this.requirePlan(merchantId);
    if (!await this.accounts.findByGlobalUserId(buyerId)) throw new ShoppingError("agent_not_found", 404);
    if (raw.name !== undefined) {
      if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.trim().length > 60) throw new ShoppingError("agent_invalid_name");
      const profile = await this.accounts.findAgentByGlobalUserId(buyerId);
      await this.accounts.saveAgent(new BuyerAgentProfile(profile ? { ...profile, name: raw.name.trim(), updatedAt: new Date() }
        : { id: newId(), globalUserId: buyerId, name: raw.name.trim(), personality: "balanced", maxRounds: 3, targetDiscountPercent: 5, minimumAcceptableDiscountPercent: 0, m2mEnabled: false, createdAt: new Date(), updatedAt: new Date() }));
    }
    if (!current) await this.repo.create(buyerId, merchantId, freshState(settings));
    await this.mutate(buyerId, merchantId, state => {
      // Resolve a concurrent settings update against the latest consent.
      const wasEnabled = state.settings.enabled;
      state.settings = validateSettings(input, state.settings);
      if (!state.settings.enabled) for (const activity of state.activities) {
        if (activity.decision === "pending") activity.decision = "dismissed";
        for (const delivery of Object.values(activity.deliveries)) if (delivery?.status === "pending") delivery.status = "skipped";
      }
      if (!wasEnabled && state.settings.enabled) for (const task of state.tasks.filter(t => t.status === "active")) {
        task.matched = false;
        if (task.config.kind !== "reorder") task.nextRunAt = new Date().toISOString();
      }
    });
    return this.get(buyerId, merchantId);
  }
  async createTask(buyerId: string, merchantId: string, input: unknown, requestKey: string, now = new Date()) {
    await this.requirePlan(merchantId);
    if (!/^[\w-]{8,100}$/.test(requestKey)) throw new ShoppingError("agent_idempotency_key_required");
    const config = validateConfig(input, now);
    const existing = (await this.repo.find(buyerId, merchantId))?.state.tasks.find(t => t.requestKey === requestKey);
    if (existing) {
      if (fingerprint(existing.config) !== fingerprint(config)) throw new ShoppingError("agent_idempotency_conflict", 409);
      return existing;
    }
    // Validate the exact tenant/product/variant before persisting a job.
    await this.commerce.quote(merchantId, config, now);
    const id = newId();
    await this.mutate(buyerId, merchantId, state => {
      if (!state.settings.enabled) throw new ShoppingError("agent_disabled", 409);
      const previous = state.tasks.find(t => t.requestKey === requestKey);
      if (previous) {
        if (fingerprint(previous.config) !== fingerprint(config)) throw new ShoppingError("agent_idempotency_conflict", 409);
        return;
      }
      if (state.tasks.filter(t => t.status === "active" || t.status === "paused").length >= 25) throw new ShoppingError("agent_task_limit", 409);
      const recentClosed = state.tasks.filter(t => t.status === "cancelled" || t.status === "expired").slice(-25);
      state.tasks = state.tasks.filter(t => t.status === "active" || t.status === "paused" || recentClosed.some(closed => closed.id === t.id));
      state.tasks.push({ id, revision: 1, config, status: "active", createdAt: now.toISOString(),
        nextRunAt: config.kind === "reorder" ? new Date(now.getTime() + config.intervalDays! * 86_400_000).toISOString() : now.toISOString(),
        matched: false, cycle: 0, failures: 0, requestKey });
    });
    const saved = await this.repo.find(buyerId, merchantId);
    return saved!.state.tasks.find(t => t.requestKey === requestKey)!;
  }
  async changeTask(buyerId: string, merchantId: string, taskId: string, input: { action?: unknown; revision?: unknown; config?: unknown }, now = new Date()) {
    const action = input.action;
    if (!["pause", "resume", "cancel", "skip", "update", "check"].includes(String(action))) throw new ShoppingError("agent_invalid_action");
    if (["resume", "update", "check"].includes(String(action))) await this.requirePlan(merchantId);
    const config = action === "update" ? validateConfig(input.config, now) : undefined;
    if (config) await this.commerce.quote(merchantId, config, now);
    await this.mutate(buyerId, merchantId, state => {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) throw new ShoppingError("agent_task_not_found", 404);
      if (task.revision !== input.revision) throw new ShoppingError("agent_task_changed", 409);
      if (task.status === "cancelled") throw new ShoppingError("agent_task_cancelled", 409);
      if (["resume", "check", "update"].includes(String(action)) && !state.settings.enabled) throw new ShoppingError("agent_disabled", 409);
      if (action === "skip" && task.config.kind !== "reorder") throw new ShoppingError("agent_not_recurring");
      if (action === "resume" && task.config.expiresAt && Date.parse(task.config.expiresAt) <= now.getTime()) throw new ShoppingError("agent_task_expired", 409);
      if (action === "check" && task.lastRunAt && now.getTime() - Date.parse(task.lastRunAt) < 300_000) throw new ShoppingError("agent_check_cooldown", 429);
      if (action === "pause") task.status = "paused";
      if (action === "cancel") task.status = "cancelled";
      if (action === "resume") {
        task.status = "active"; task.matched = false;
        if (task.config.kind !== "reorder" || Date.parse(task.nextRunAt) < now.getTime()) task.nextRunAt = now.toISOString();
      }
      if (action === "skip") {
        const hasCurrentProposal = state.activities.some(a => a.taskId === task.id && a.taskRevision === task.revision && a.decision === "pending");
        const reference = hasCurrentProposal ? now : new Date(Math.max(now.getTime(), Date.parse(task.nextRunAt)));
        task.cycle++; task.nextRunAt = nextCycle(task, reference);
      }
      if (action === "check") { task.nextRunAt = now.toISOString(); task.matched = false; }
      if (config) {
        task.config = config; task.status = "active"; task.matched = false; task.lastFingerprint = undefined;
        if (config.kind === "reorder") task.createdAt = now.toISOString();
        task.nextRunAt = config.kind === "reorder" ? nextCycle(task, now) : now.toISOString();
      }
      task.revision++;
      for (const activity of state.activities) if (activity.taskId === taskId && activity.decision === "pending") activity.decision = "dismissed";
    });
    return this.get(buyerId, merchantId);
  }
  async decide(buyerId: string, merchantId: string, activityId: string, action: string, origin: string) {
    if (!["read", "dismiss", "checkout"].includes(action)) throw new ShoppingError("agent_invalid_action");
    if (action === "checkout") await this.requirePlan(merchantId);
    let current = await this.repo.find(buyerId, merchantId);
    let activity = current?.state.activities.find(a => a.id === activityId);
    if (!activity) throw new ShoppingError("agent_activity_not_found", 404);
    if (action !== "checkout") {
      await this.mutate(buyerId, merchantId, state => {
        const item = state.activities.find(a => a.id === activityId)!;
        item.readAt ??= new Date().toISOString();
        if (action === "dismiss") item.decision = "dismissed";
      });
      return { success: true };
    }
    const task = current!.state.tasks.find(t => t.id === activity!.taskId);
    this.assertCheckout(current!, task, activity);
    const latest = await this.commerce.quote(merchantId, task!.config, new Date());
    if (!latest.available || latest.fingerprint !== activity.quote!.fingerprint) {
      await this.mutate(buyerId, merchantId, state => { const row = state.activities.find(a => a.id === activityId)!; row.decision = "expired"; });
      throw new ShoppingError("agent_quote_changed", 409);
    }
    // A deterministic cart/session makes a retry reopen the same purchase.
    current = await this.repo.find(buyerId, merchantId);
    activity = current?.state.activities.find(a => a.id === activityId);
    this.assertCheckout(current!, current?.state.tasks.find(t => t.id === task!.id), activity!);
    const checkout = await this.commerce.prepare(buyerId, merchantId, activityId, task!.config, latest, origin);
    await this.mutate(buyerId, merchantId, state => {
      const row = state.activities.find(a => a.id === activityId)!;
      this.assertCheckout({ ...current!, state }, state.tasks.find(t => t.id === task!.id), row);
      row.decision = "checkout"; row.quote = latest; row.checkoutRef = checkout.cartRef; row.readAt ??= new Date().toISOString();
    });
    return checkout;
  }
  private assertCheckout(workspace: Workspace, task: ShoppingTask | undefined, activity: ShoppingActivity) {
    if (!workspace?.state.settings.enabled || task?.status !== "active" || task.revision !== activity?.taskRevision || !["pending", "checkout"].includes(activity?.decision) || !activity?.quote) throw new ShoppingError("agent_approval_unavailable", 409);
    // Review always obtains a fresh quote; a historical expiry alone cannot authorize a purchase.
    if (task.config.expiresAt && Date.parse(task.config.expiresAt) <= Date.now()) throw new ShoppingError("agent_task_expired", 409);
  }
  async mutate<T>(buyerId: string, merchantId: string, apply: (state: ShoppingState) => T, now = new Date()): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.repo.find(buyerId, merchantId);
      if (!row) throw new ShoppingError("agent_not_configured", 404);
      const state = structuredClone(row.state);
      const result = apply(state);
      if (await this.repo.compareAndSwap(row, state, nextCheck(state, now))) return result;
    }
    throw new ShoppingError("agent_concurrent_update", 409);
  }
}
