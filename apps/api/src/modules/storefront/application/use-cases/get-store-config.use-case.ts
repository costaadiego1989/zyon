/**
 * Get store config use-case.
 *
 * Resolves a merchant by ID or slugified name and returns
 * the public storefront configuration (theme, name, logo).
 */

import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { decodePersistedTheme } from "../../../merchant/domain/services/merchant-theme.validators.js";

export interface StoreConfigOutput {
  merchantId: string;
  name: string;
  logo?: string;
  favicon?: string;
  theme: {
    accentColor: string;
    secondaryColor?: string;
    textColor: string;
    backgroundColor: string;
    fontFamily: string;
    fontDisplay?: string;
    logoUrl?: string;
    agentAvatarUrl?: string;
    surfaceColor?: string;
    surfaceElevatedColor?: string;
    borderColor?: string;
  };
  agentName?: string;
  agentGreeting?: string;
  quickReplies?: string[];
  storeCategory?: string;
  storeSettings?: Record<string, unknown>;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

@Injectable()
export class GetStoreConfigUseCase {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  async execute(slug: string): Promise<StoreConfigOutput> {
    // Try by ID first
    let row = await this.prisma.merchant.findUnique({ where: { id: slug } });

    // If not found, try persisted slug in storeSettings, then slugified name
    if (!row) {
      const merchants = await this.prisma.merchant.findMany({
        select: { id: true, name: true, theme: true, storeSettings: true }
      });
      const match = merchants.find((m) => {
        const settings = m.storeSettings as Record<string, unknown> | null;
        const persistedSlug = settings?.slug as string | undefined;
        if (persistedSlug === slug) return true;
        return slugify(m.name) === slug;
      });
      if (match) {
        row = await this.prisma.merchant.findUnique({ where: { id: match.id } });
      }
    }

    if (!row) {
      throw new NotFoundException("store_not_found");
    }

    const theme = decodePersistedTheme(row.theme);

    // Read agent identity from agent_rules (source of truth for agent name)
    let agentName = theme?.agentName;
    let agentGreeting: string | undefined;
    try {
      const agentRule = await this.prisma.agentRule.findFirst({
        where: { merchantId: row.id },
        select: { identity: true },
      });
      const identity = agentRule?.identity as { agentName?: string; greeting?: string } | null;
      if (identity?.agentName) agentName = identity.agentName;
      if (identity?.greeting) agentGreeting = identity.greeting;
    } catch {}

    return {
      merchantId: row.id,
      name: row.name,
      logo: theme?.logoUrl ?? undefined,
      favicon: theme?.logoUrl ?? undefined,
      theme: {
        accentColor: theme?.accentColor ?? "#0F766E",
        secondaryColor: theme?.secondaryColor,
        textColor: theme?.textColor ?? "#111827",
        backgroundColor: theme?.backgroundColor ?? "#F7F8FA",
        fontFamily: theme?.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif",
        fontDisplay: (theme as any)?.fontDisplay ?? undefined,
        logoUrl: theme?.logoUrl,
        agentAvatarUrl: theme?.agentAvatarUrl,
        surfaceColor: theme?.surfaceColor,
        surfaceElevatedColor: theme?.surfaceElevatedColor,
        borderColor: theme?.borderColor,
      },
      agentName,
      agentGreeting,
      quickReplies: ["Ver produtos", "Encontrar produto", "Ver categorias", "Promoções", "Rastrear pedido", "Meus dados"],
      storeCategory: row.storeCategory ?? undefined,
      storeSettings: (row.storeSettings as Record<string, unknown>) ?? undefined,
    };
  }
}
