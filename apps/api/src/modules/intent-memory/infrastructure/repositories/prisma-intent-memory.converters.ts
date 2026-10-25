import type { Prisma } from "@prisma/client";
import type { BuyerIntentMemoryConsent, CustomerIntentRecord } from "@zyon/shared-types";

/**
 * M1: Explicit JSON converters for Prisma <-> domain.
 * Handles field name mappings: snake_case (DB) <-> camelCase (domain).
 */

export interface CustomerIntentRecordPrismaRow {
  id: string;
  merchantId: string;
  globalUserId: string;
  primaryIntent: string;
  urgency: string;
  budgetTier: string;
  categoryFocus: string[];
  painPoints: string[];
  conversionLikelihoodPct: number;
  behavioralSignalsJson: unknown;
  generatedAt: Date;
}

export interface BuyerIntentMemoryConsentPrismaRow {
  merchantId: string;
  globalUserId: string;
  optedIn: boolean;
  expiresAt: Date;
  updatedAt: Date;
}

export function toDomainRecord(row: CustomerIntentRecordPrismaRow): CustomerIntentRecord {
  return {
    id: row.id,
    merchant_id: row.merchantId,
    global_user_id: row.globalUserId,
    primary_intent: row.primaryIntent,
    urgency: row.urgency as "low" | "medium" | "high",
    budget_tier: row.budgetTier as "budget" | "mid" | "premium",
    category_focus: row.categoryFocus,
    pain_points: row.painPoints,
    conversion_likelihood_percent: row.conversionLikelihoodPct,
    behavioral_signals: row.behavioralSignalsJson as unknown as import("@zyon/shared-types").BehavioralSignals,
    generated_at: row.generatedAt.toISOString()
  };
}

export function toPrismaCreateRecord(record: CustomerIntentRecord) {
  return {
    merchantId: record.merchant_id,
    globalUserId: record.global_user_id,
    primaryIntent: record.primary_intent,
    urgency: record.urgency,
    budgetTier: record.budget_tier,
    categoryFocus: record.category_focus,
    painPoints: record.pain_points,
    conversionLikelihoodPct: record.conversion_likelihood_percent,
    behavioralSignalsJson: record.behavioral_signals as unknown as Prisma.InputJsonValue,
    generatedAt: new Date(record.generated_at)
  };
}

export function toPrismaUpdateRecord(record: CustomerIntentRecord) {
  return {
    primaryIntent: record.primary_intent,
    urgency: record.urgency,
    budgetTier: record.budget_tier,
    categoryFocus: record.category_focus,
    painPoints: record.pain_points,
    conversionLikelihoodPct: record.conversion_likelihood_percent,
    behavioralSignalsJson: record.behavioral_signals as unknown as Prisma.InputJsonValue,
    generatedAt: new Date(record.generated_at)
  };
}

export function toDomainConsent(row: BuyerIntentMemoryConsentPrismaRow): BuyerIntentMemoryConsent {
  return {
    merchant_id: row.merchantId,
    global_user_id: row.globalUserId,
    opted_in: row.optedIn,
    expires_at: row.expiresAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

export function toPrismaCreateConsent(consent: BuyerIntentMemoryConsent) {
  return {
    merchantId: consent.merchant_id,
    globalUserId: consent.global_user_id,
    optedIn: consent.opted_in,
    expiresAt: new Date(consent.expires_at)
  };
}

export function toPrismaUpdateConsent(consent: BuyerIntentMemoryConsent) {
  return {
    optedIn: consent.opted_in,
    expiresAt: new Date(consent.expires_at)
  };
}
