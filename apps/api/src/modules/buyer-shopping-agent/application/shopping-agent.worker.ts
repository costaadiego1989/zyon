import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { ShoppingAgentService } from "./shopping-agent.service.js";
import { SHOPPING_NOTIFIER, type ShoppingNotifier } from "../infrastructure/shopping-notifier.service.js";
import { ShoppingError, inQuietHours, localDay, newId, nextCycle, type Workspace, type ShoppingActivity } from "../domain/shopping-agent.js";

@Injectable()
export class ShoppingAgentWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(ShoppingAgentWorker.name);
  constructor(private readonly agent: ShoppingAgentService, @Inject(SHOPPING_NOTIFIER) private readonly notifier: ShoppingNotifier) {}
  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => { void this.tick().catch(() => this.logger.warn("shopping_agent_tick_failed")); }, 30_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    const leaseId = newId();
    try {
      const rows = await this.agent.repo.claimDue(now, leaseId, 5);
      await Promise.all(rows.map(async row => {
        try { await this.process(row, now); }
        catch { this.logger.warn({ event: "shopping_agent_workspace_failed", workspaceId: row.id }); }
        finally { await this.agent.repo.release(row.id, leaseId); }
      }));
    } finally { this.running = false; }
  }
  async process(workspace: Workspace, now = new Date()) {
    if (!workspace.state.settings.enabled) {
      await this.agent.mutate(workspace.globalUserId, workspace.merchantId, () => undefined, now);
      await this.deliver(workspace, now); return;
    }
    if (!await this.agent.allowed(workspace.merchantId)) {
      await this.agent.mutate(workspace.globalUserId, workspace.merchantId, state => {
        for (const task of state.tasks.filter(t => t.status === "active")) { task.lastOutcome = "premium_required"; task.nextRunAt = new Date(now.getTime() + 86_400_000).toISOString(); }
      }, now); return;
    }
    for (const candidate of workspace.state.tasks) {
      const latest = await this.agent.repo.find(workspace.globalUserId, workspace.merchantId);
      if (!latest?.state.settings.enabled) break;
      if (workspace.leaseId && (latest.leaseId !== workspace.leaseId || !latest.leaseUntil || latest.leaseUntil.getTime() <= Date.now())) break;
      const task = latest.state.tasks.find(t => t.id === candidate.id);
      if (!task || task.status !== "active") continue;
      if (task.config.expiresAt && Date.parse(task.config.expiresAt) <= now.getTime()) {
        await this.agent.mutate(workspace.globalUserId, workspace.merchantId, state => {
          const current = state.tasks.find(t => t.id === task.id);
          if (current?.revision === task.revision) { current.status = "expired"; current.revision++; }
        }, now); continue;
      }
      if (Date.parse(task.nextRunAt) > now.getTime()) continue;
      try {
        const quote = await this.agent.commerce.quote(workspace.merchantId, task.config, now);
        const recurring = task.config.kind === "reorder";
        const fitsBudget = !task.config.targetCents || quote.totalCents <= task.config.targetCents;
        const matches = quote.available && fitsBudget && (task.config.kind !== "negotiate" || quote.discountPercent > 0 && quote.discountPercent >= task.config.targetDiscountPercent);
        await this.agent.mutate(workspace.globalUserId, workspace.merchantId, state => {
          const current = state.tasks.find(t => t.id === task.id);
          if (!state.settings.enabled || !current || current.status !== "active" || current.revision !== task.revision || current.nextRunAt !== task.nextRunAt) return;
          current.lastRunAt = now.toISOString(); current.failures = 0;
          current.nextRunAt = recurring ? nextCycle(current, now) : new Date(now.getTime() + 900_000).toISOString();
          current.lastOutcome = !quote.available ? "unavailable" : !fitsBudget ? "over_budget" : matches ? "opportunity" : "monitoring";
          const shouldNotify = recurring || matches && (!current.matched || current.lastFingerprint !== quote.fingerprint);
          if (shouldNotify) {
            for (const previous of state.activities) if (previous.taskId === task.id && previous.decision === "pending") previous.decision = "expired";
            current.cycle++;
            const activity: ShoppingActivity = { id: newId(), taskId: task.id, taskRevision: task.revision,
              key: `${task.id}:${task.revision}:${current.cycle}`, createdAt: now.toISOString(), kind: matches ? "opportunity" : quote.available ? "over_budget" : "unavailable",
              message: matches ? `Encontramos uma condição para “${task.config.title}”. Revise o total e confirme se deseja comprar.`
                : quote.available ? `A compra “${task.config.title}” ultrapassou seu limite. Este ciclo não foi comprado.` : `Há itens indisponíveis em “${task.config.title}”. Este ciclo não foi comprado.`,
              quote, decision: matches ? "pending" : "dismissed", deliveries: {} };
            if (state.settings.email) activity.deliveries.email = { status: "pending" };
            if (state.settings.whatsapp) activity.deliveries.whatsapp = { status: "pending" };
            state.activities.unshift(activity);
            for (const previous of state.activities) if (previous.decision === "pending" && Date.parse(previous.createdAt) < now.getTime() - 86_400_000) previous.decision = "expired";
            // Bound aggregate size; retain every unresolved approval or delivery.
            state.activities = state.activities.filter((a, i) => i < 100 || a.decision === "pending" || Object.values(a.deliveries).some(d => d?.status === "pending" || d?.status === "sending"));
          }
          current.matched = matches; current.lastFingerprint = quote.fingerprint;
        }, now);
      } catch (error) {
        await this.agent.mutate(workspace.globalUserId, workspace.merchantId, state => {
          const current = state.tasks.find(t => t.id === task.id);
          if (!current || current.revision !== task.revision || current.status !== "active" || current.nextRunAt !== task.nextRunAt) return;
          current.failures++; current.lastRunAt = now.toISOString();
          current.lastOutcome = error instanceof ShoppingError ? error.code : "temporarily_unavailable";
          current.nextRunAt = new Date(now.getTime() + Math.min(21_600_000, 300_000 * 2 ** Math.min(current.failures, 6))).toISOString();
        }, now);
      }
    }
    await this.deliver(workspace, now);
  }
  async deliver(workspace: Workspace, now: Date) {
    const row = await this.agent.repo.find(workspace.globalUserId, workspace.merchantId);
    if (!row) return;
    for (const activity of [...row.state.activities].reverse()) for (const channel of ["email", "whatsapp"] as const) {
      const scheduled = activity.deliveries[channel];
      if (!scheduled || !["pending", "sending"].includes(scheduled.status)) continue;
      let send: ShoppingActivity | undefined;
      await this.agent.mutate(workspace.globalUserId, workspace.merchantId, state => {
        send = undefined;
        const item = state.activities.find(a => a.id === activity.id);
        const delivery = item?.deliveries[channel];
        if (!item || !delivery) return;
        if (delivery.status === "sending" && delivery.attemptedAt && now.getTime() - Date.parse(delivery.attemptedAt) > 300_000) { delivery.status = "uncertain"; return; }
        if (delivery.status !== "pending") return;
        const task = state.tasks.find(t => t.id === item.taskId);
        if (!state.settings.enabled || !state.settings[channel] || !task || task.status !== "active" || task.revision !== item.taskRevision || Date.parse(item.createdAt) < now.getTime() - 86_400_000 || item.decision === "expired" || item.decision === "checkout" || item.kind === "opportunity" && item.decision === "dismissed") { delivery.status = "skipped"; return; }
        if (inQuietHours(state.settings, now)) return;
        const sentToday = state.activities.filter(a => Object.values(a.deliveries).some(d => d?.attemptedAt && localDay(state.settings, new Date(d.attemptedAt)) === localDay(state.settings, now))).length;
        if (sentToday >= state.settings.maxDailyNotifications && !Object.values(item.deliveries).some(d => d?.attemptedAt && localDay(state.settings, new Date(d.attemptedAt)) === localDay(state.settings, now))) return;
        delivery.status = "sending"; delivery.attemptedAt = now.toISOString(); send = structuredClone(item);
      }, now);
      if (!send) continue;
      const latest = await this.agent.repo.find(workspace.globalUserId, workspace.merchantId);
      const task = latest?.state.tasks.find(t => t.id === send!.taskId);
      if (!latest?.state.settings.enabled || !latest.state.settings[channel] || task?.status !== "active" || task.revision !== send.taskRevision || !await this.agent.allowed(workspace.merchantId)) {
        await this.agent.mutate(workspace.globalUserId, workspace.merchantId, state => { const d = state.activities.find(a => a.id === activity.id)?.deliveries[channel]; if (d) d.status = "skipped"; }, now); continue;
      }
      let result: { status: "sent" | "skipped" | "uncertain"; providerId?: string };
      try { result = await this.notifier.send({ buyerId: workspace.globalUserId, merchantId: workspace.merchantId, channel, activity: send }); }
      catch { result = { status: "uncertain" }; }
      await this.agent.mutate(workspace.globalUserId, workspace.merchantId, state => {
        const d = state.activities.find(a => a.id === activity.id)?.deliveries[channel]; if (d) { d.status = result.status; d.providerId = result.providerId; }
      }, now);
    }
  }
}
