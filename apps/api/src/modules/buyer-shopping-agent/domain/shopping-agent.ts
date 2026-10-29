import { createHash, randomUUID } from "node:crypto";
import { AGENT_AVATAR_STYLES, AGENT_AVATAR_COLORS, AGENT_AVATAR_EXPRESSIONS, DEFAULT_AGENT_APPEARANCE, type ShoppingAgentAppearance } from "@zyon/shared-types";

export const TASK_KINDS = ["price_watch", "restock", "reorder", "negotiate", "basket_budget"] as const;
export type TaskKind = typeof TASK_KINDS[number];
export type TaskStatus = "active" | "paused" | "cancelled" | "expired";
export interface ShoppingItem { productId: string; variantId: string; quantity: number }
export interface TaskConfig {
  kind: TaskKind;
  title: string;
  items: ShoppingItem[];
  targetCents?: number;
  includeShipping: boolean;
  destinationZip?: string;
  maxDeliveryDays?: number;
  intervalDays?: number;
  targetDiscountPercent: number;
  expiresAt?: string;
}
export interface ShoppingTask {
  id: string; revision: number; config: TaskConfig; status: TaskStatus;
  createdAt: string; nextRunAt: string; lastRunAt?: string; lastOutcome?: string;
  lastFingerprint?: string; matched: boolean; cycle: number; failures: number;
  requestKey: string;
}
export interface ShoppingQuote {
  items: Array<ShoppingItem & { name: string; sku: string; unitPriceCents: number; categoryId?: string }>;
  subtotalCents: number; discountCents: number; shippingCents: number | null; serviceFeeCents: number;
  totalCents: number; currency: "BRL"; available: boolean;
  shippingLabel?: string; deliveryDays?: number; discountPercent: number;
  negotiationSessionId?: string; fingerprint: string; expiresAt: string;
}
export interface ShoppingActivity {
  id: string; taskId: string; taskRevision: number; key: string; createdAt: string;
  kind: "opportunity" | "unavailable" | "over_budget" | "error" | "cancelled";
  message: string; readAt?: string; quote?: ShoppingQuote;
  decision: "pending" | "dismissed" | "checkout" | "expired";
  checkoutRef?: string;
  deliveries: Partial<Record<"email" | "whatsapp", {
    status: "pending" | "sending" | "sent" | "skipped" | "uncertain";
    attemptedAt?: string; providerId?: string;
  }>>;
}
export interface AgentSettings {
  enabled: boolean; consentVersion: "1"; consentAt: string;
  email: boolean; whatsapp: boolean; quietStart: number; quietEnd: number;
  timeZone: string; maxDailyNotifications: number;
  appearance?: ShoppingAgentAppearance;
}
export interface ShoppingState {
  version: 1; settings: AgentSettings; tasks: ShoppingTask[]; activities: ShoppingActivity[];
}
export interface Workspace {
  id: string; globalUserId: string; merchantId: string; revision: number;
  state: ShoppingState; nextCheckAt: Date; leaseId: string | null; leaseUntil: Date | null;
}
export const SHOPPING_REPOSITORY = Symbol("ShoppingAgentRepository");
export interface ShoppingRepository {
  find(buyerId: string, merchantId: string): Promise<Workspace | null>;
  create(buyerId: string, merchantId: string, state: ShoppingState): Promise<Workspace>;
  compareAndSwap(workspace: Workspace, state: ShoppingState, nextCheckAt: Date): Promise<boolean>;
  claimDue(now: Date, leaseId: string, limit: number): Promise<Workspace[]>;
  release(id: string, leaseId: string): Promise<void>;
}

export class ShoppingError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShoppingError("agent_invalid_input");
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new ShoppingError(code);
  return Number(value);
}
export function validateConfig(value: unknown, now = new Date()): TaskConfig {
  const input = object(value);
  if (!TASK_KINDS.includes(input.kind as TaskKind)) throw new ShoppingError("agent_invalid_task_kind");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 120) throw new ShoppingError("agent_invalid_title");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 20) throw new ShoppingError("agent_invalid_items");
  const items = input.items.map(raw => {
    const item = object(raw);
    for (const key of ["productId", "variantId"] as const) if (typeof item[key] !== "string" || !/^[\w-]{1,160}$/.test(item[key] as string)) throw new ShoppingError("agent_invalid_item");
    return { productId: item.productId as string, variantId: item.variantId as string, quantity: integer(item.quantity, 1, 100, "agent_invalid_quantity") };
  });
  if (new Set(items.map(i => i.variantId)).size !== items.length) throw new ShoppingError("agent_duplicate_variant");
  if (typeof input.includeShipping !== "boolean") throw new ShoppingError("agent_shipping_choice_required");
  const config: TaskConfig = { kind: input.kind as TaskKind, title, items, includeShipping: input.includeShipping,
    targetDiscountPercent: integer(input.targetDiscountPercent ?? 0, 0, 50, "agent_invalid_discount") };
  if (input.targetCents !== undefined) config.targetCents = integer(input.targetCents, 1, 100_000_000, "agent_invalid_budget");
  if (["price_watch", "basket_budget"].includes(config.kind) && !config.targetCents) throw new ShoppingError("agent_budget_required");
  if (input.destinationZip !== undefined && input.destinationZip !== "") {
    if (typeof input.destinationZip !== "string" || !/^\d{5}-?\d{3}$/.test(input.destinationZip)) throw new ShoppingError("agent_invalid_zip");
    config.destinationZip = input.destinationZip.replace(/\D/g, "");
  }
  if (config.includeShipping && !config.destinationZip) throw new ShoppingError("agent_destination_required");
  if (input.maxDeliveryDays !== undefined) config.maxDeliveryDays = integer(input.maxDeliveryDays, 1, 365, "agent_invalid_delivery_days");
  if (config.maxDeliveryDays && !config.includeShipping) throw new ShoppingError("agent_shipping_required_for_deadline");
  if (config.kind === "reorder") config.intervalDays = integer(input.intervalDays, 1, 365, "agent_invalid_interval");
  if (input.expiresAt !== undefined) {
    if (typeof input.expiresAt !== "string" || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now.getTime()) throw new ShoppingError("agent_invalid_expiry");
    config.expiresAt = new Date(input.expiresAt).toISOString();
  }
  return config;
}
export function validateAppearance(value: unknown): ShoppingAgentAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShoppingError("agent_invalid_appearance");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["version", "style", "color", "expression"].includes(key)) ||
      input.version !== 1 || !AGENT_AVATAR_STYLES.includes(input.style as ShoppingAgentAppearance["style"]) ||
      !AGENT_AVATAR_COLORS.includes(input.color as ShoppingAgentAppearance["color"]) ||
      !AGENT_AVATAR_EXPRESSIONS.includes(input.expression as ShoppingAgentAppearance["expression"])) throw new ShoppingError("agent_invalid_appearance");
  return { version: 1, style: input.style as ShoppingAgentAppearance["style"], color: input.color as ShoppingAgentAppearance["color"], expression: input.expression as ShoppingAgentAppearance["expression"] };
}
export function validateSettings(value: unknown, current?: AgentSettings, now = new Date()): AgentSettings {
  const input = object(value);
  if (!current && input.accepted !== true) throw new ShoppingError("agent_consent_required");
  for (const key of ["enabled", "email", "whatsapp"] as const) if (input[key] !== undefined && typeof input[key] !== "boolean") throw new ShoppingError("agent_invalid_settings");
  const timeZone = input.timeZone ?? current?.timeZone ?? "America/Sao_Paulo";
  if (typeof timeZone !== "string" || timeZone.length > 80) throw new ShoppingError("agent_invalid_timezone");
  try { new Intl.DateTimeFormat("pt-BR", { timeZone }).format(now); } catch { throw new ShoppingError("agent_invalid_timezone"); }
  return { enabled: input.enabled as boolean ?? current?.enabled ?? true, consentVersion: "1", consentAt: current?.consentAt ?? now.toISOString(),
    email: input.email as boolean ?? current?.email ?? false, whatsapp: input.whatsapp as boolean ?? current?.whatsapp ?? false,
    quietStart: integer(input.quietStart ?? current?.quietStart ?? 22, 0, 23, "agent_invalid_quiet_hours"),
    quietEnd: integer(input.quietEnd ?? current?.quietEnd ?? 8, 0, 23, "agent_invalid_quiet_hours"), timeZone,
    maxDailyNotifications: integer(input.maxDailyNotifications ?? current?.maxDailyNotifications ?? 3, 1, 20, "agent_invalid_notification_limit"),
    appearance: validateAppearance(input.appearance === undefined ? current?.appearance ?? DEFAULT_AGENT_APPEARANCE : input.appearance) };
}
export function inQuietHours(settings: AgentSettings, now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: settings.timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return settings.quietStart === settings.quietEnd ? false : settings.quietStart < settings.quietEnd
    ? hour >= settings.quietStart && hour < settings.quietEnd : hour >= settings.quietStart || hour < settings.quietEnd;
}
export function localDay(settings: AgentSettings, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: settings.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function nextCycle(task: ShoppingTask, now: Date): string {
  const period = (task.config.intervalDays ?? 1) * 86_400_000;
  const anchor = new Date(task.createdAt).getTime();
  return new Date(anchor + (Math.floor(Math.max(0, now.getTime() - anchor) / period) + 1) * period).toISOString();
}
export function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
  return createHash("sha256").update(serialized).digest("hex");
}
export function newId(): string { return randomUUID(); }
export function nextCheck(state: ShoppingState, now = new Date()): Date {
  const confirmingSend = state.activities.some(a => Object.values(a.deliveries).some(d => d?.status === "sending"));
  if (!state.settings.enabled) return new Date(now.getTime() + (confirmingSend ? 60_000 : 86_400_000));
  const due = state.tasks.filter(t => t.status === "active").map(t => Math.min(Date.parse(t.nextRunAt), t.config.expiresAt ? Date.parse(t.config.expiresAt) : Infinity));
  if (state.activities.some(a => Object.values(a.deliveries).some(d => d?.status === "pending" || d?.status === "sending"))) due.push(now.getTime() + 60_000);
  return new Date(Math.max(now.getTime() + 30_000, Math.min(now.getTime() + 86_400_000, ...due)));
}
export function freshState(settings: AgentSettings): ShoppingState { return { version: 1, settings, tasks: [], activities: [] }; }
