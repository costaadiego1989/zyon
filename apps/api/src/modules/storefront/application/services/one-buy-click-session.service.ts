import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export type OneBuyClickShippingPreference = "fastest" | "cheapest";
export type OneBuyClickPaymentPreference = "pix" | "card";
export type OneBuyClickStatus = "idle" | "resolving" | "awaiting_choice" | "ready_for_payment" | "handed_off" | "paused" | "failed" | "completed";

export interface OneBuyClickState {
  enabled: boolean;
  status: OneBuyClickStatus;
  shippingPreference: OneBuyClickShippingPreference;
  paymentPreference: OneBuyClickPaymentPreference;
  preparedActionId?: string;
}

interface StateInput {
  merchantId: string;
  conversationId: string;
  globalUserId?: string;
}

interface ConfigureInput extends StateInput {
  enabled: boolean;
}

interface PrepareCheckoutInput extends StateInput {
  cartFingerprint: string;
}

const SESSION_TTL_MS = 72 * 60 * 60 * 1000;
const DEFAULT_PREFERENCES = {
  oneBuyClickEnabled: false,
  shippingPreference: "fastest",
  paymentPreference: "pix",
} as const;

@Injectable()
export class OneBuyClickSessionService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async get(input: StateInput): Promise<OneBuyClickState> {
    const row = await this.sessionStore().findUnique({
      where: { merchantId_conversationId: this.sessionKey(input) },
    });
    if (row && row.expiresAt > new Date()) return this.toState(row);

    return this.initialize(input);
  }

  async configure(input: ConfigureInput): Promise<OneBuyClickState> {
    const current = await this.get(input);
    const nextStatus: OneBuyClickStatus = input.enabled
      ? current.status === "paused" ? "idle" : current.status
      : "paused";
    const row = await this.sessionStore().upsert({
      where: { merchantId_conversationId: this.sessionKey(input) },
      create: this.createInput(input, { ...current, enabled: input.enabled, status: nextStatus }),
      update: {
        enabled: input.enabled,
        status: nextStatus,
        ...(input.globalUserId ? { globalUserId: input.globalUserId } : {}),
        expiresAt: this.expiration(),
      },
    });
    return this.toState(row);
  }

  async prepareCheckout(input: PrepareCheckoutInput): Promise<OneBuyClickState> {
    const current = await this.get(input);
    if (!current.enabled) return current;

    const sameCart = await this.hasPreparedCart(input, current);
    if (sameCart) return current;

    const row = await this.sessionStore().upsert({
      where: { merchantId_conversationId: this.sessionKey(input) },
      create: this.createInput(input, {
        ...current,
        status: "ready_for_payment",
        preparedActionId: randomUUID(),
      }, input.cartFingerprint),
      update: {
        status: "ready_for_payment",
        cartFingerprint: input.cartFingerprint,
        preparedActionId: randomUUID(),
        preparedAt: new Date(),
        ...(input.globalUserId ? { globalUserId: input.globalUserId } : {}),
        expiresAt: this.expiration(),
      },
    });
    return this.toState(row);
  }

  private async initialize(input: StateInput): Promise<OneBuyClickState> {
    const preference = await this.preferenceFor(input.globalUserId);
    const state: OneBuyClickState = {
      enabled: preference.oneBuyClickEnabled,
      status: preference.oneBuyClickEnabled ? "idle" : "paused",
      shippingPreference: preference.shippingPreference,
      paymentPreference: preference.paymentPreference,
    };
    const row = await this.sessionStore().upsert({
      where: { merchantId_conversationId: this.sessionKey(input) },
      create: this.createInput(input, state),
      update: {
        ...(input.globalUserId ? { globalUserId: input.globalUserId } : {}),
        enabled: state.enabled,
        status: state.status,
        shippingPreference: state.shippingPreference,
        paymentPreference: state.paymentPreference,
        cartFingerprint: null,
        preparedActionId: null,
        preparedAt: null,
        expiresAt: this.expiration(),
      },
    });
    return this.toState(row);
  }

  private async hasPreparedCart(input: PrepareCheckoutInput, state: OneBuyClickState): Promise<boolean> {
    if (state.status !== "ready_for_payment" || !state.preparedActionId) return false;
    const row = await this.sessionStore().findUnique({
      where: { merchantId_conversationId: this.sessionKey(input) },
      select: { cartFingerprint: true, expiresAt: true },
    });
    return row?.cartFingerprint === input.cartFingerprint && row.expiresAt > new Date();
  }

  private async preferenceFor(globalUserId?: string): Promise<{
    oneBuyClickEnabled: boolean;
    shippingPreference: OneBuyClickShippingPreference;
    paymentPreference: OneBuyClickPaymentPreference;
  }> {
    if (!globalUserId) return { ...DEFAULT_PREFERENCES };
    const row = await (this.prisma as any).buyerPreference.findUnique({
      where: { globalUserId },
      select: { oneBuyClickEnabled: true, shippingPreference: true, paymentPreference: true },
    });
    if (!row) return { ...DEFAULT_PREFERENCES };
    return {
      oneBuyClickEnabled: row.oneBuyClickEnabled === true,
      shippingPreference: this.shippingPreference(row.shippingPreference),
      paymentPreference: this.paymentPreference(row.paymentPreference),
    };
  }

  private createInput(input: StateInput, state: OneBuyClickState, cartFingerprint?: string) {
    return {
      merchantId: input.merchantId,
      conversationId: input.conversationId,
      globalUserId: input.globalUserId,
      enabled: state.enabled,
      status: state.status,
      shippingPreference: state.shippingPreference,
      paymentPreference: state.paymentPreference,
      ...(cartFingerprint ? { cartFingerprint, preparedActionId: state.preparedActionId, preparedAt: new Date() } : {}),
      expiresAt: this.expiration(),
    };
  }

  private sessionKey(input: StateInput) {
    return { merchantId: input.merchantId, conversationId: input.conversationId };
  }

  private sessionStore() {
    return (this.prisma as any).oneBuyClickSession;
  }

  private expiration(): Date {
    return new Date(Date.now() + SESSION_TTL_MS);
  }

  private toState(row: any): OneBuyClickState {
    return {
      enabled: row.enabled === true,
      status: this.status(row.status),
      shippingPreference: this.shippingPreference(row.shippingPreference),
      paymentPreference: this.paymentPreference(row.paymentPreference),
      ...(typeof row.preparedActionId === "string" ? { preparedActionId: row.preparedActionId } : {}),
    };
  }

  private status(value: unknown): OneBuyClickStatus {
    const statuses: OneBuyClickStatus[] = ["idle", "resolving", "awaiting_choice", "ready_for_payment", "handed_off", "paused", "failed", "completed"];
    return statuses.includes(value as OneBuyClickStatus) ? value as OneBuyClickStatus : "idle";
  }

  private shippingPreference(value: unknown): OneBuyClickShippingPreference {
    return value === "cheapest" ? "cheapest" : "fastest";
  }

  private paymentPreference(value: unknown): OneBuyClickPaymentPreference {
    return value === "card" ? "card" : "pix";
  }
}
