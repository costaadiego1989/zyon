import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface StoreSettings {
  brand?: {
    logo?: string;
    colors?: {
      primary?: string;
      secondary?: string;
    };
    fonts?: {
      heading?: string;
      body?: string;
    };
  };
  domain?: {
    primary?: string;
    custom?: string[];
  };
  currency?: string;
}

@Injectable()
export class GetStoreSettingsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<StoreSettings> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { theme: true },
    });

    if (!merchant) {
      return {};
    }

    const theme = (merchant.theme ?? {}) as Record<string, unknown>;

    return {
      brand: {
        logo: (theme.logo as string | undefined) ?? undefined,
        colors: {
          primary: (theme.primary as string | undefined) ?? undefined,
          secondary: (theme.secondary as string | undefined) ?? undefined,
        },
        fonts: {
          heading: (theme.heading as string | undefined) ?? undefined,
          body: (theme.body as string | undefined) ?? undefined,
        },
      },
      domain: {
        primary: (theme.primaryDomain as string | undefined) ?? undefined,
        custom: (theme.customDomains as string[] | undefined) ?? [],
      },
      currency: (theme.currency as string | undefined) ?? "BRL",
    };
  }
}
