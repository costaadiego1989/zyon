import { BadRequestException, Inject, Injectable, Logger, NotFoundException} from "@nestjs/common";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../domain/ports/merchant-repository.port.js";
import { validateMerchantTheme } from "../domain/services/merchant-theme.validators.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { isValidStoreCategory } from "../domain/services/store-category.js";

const VALID_STORE_CATEGORIES = [
  // Varejo físico
  "electronics", "fashion", "beauty", "home_decor", "sports",
  "food_beverage", "health", "pet", "automotive", "gaming",
  "books_education", "toys_kids", "jewelry_watches", "furniture",
  "groceries", "pharmacy", "office_supplies", "music_instruments",
  // Digital & Serviços
  "digital_products", "services", "saas_software", "courses_education",
  "subscriptions", "consulting", "freelance", "events_tickets",
  // Nicho
  "handmade_artisan", "adult", "cannabis_cbd", "luxury",
  "sustainability_eco", "religious", "industrial_b2b", "wholesale",
  "dropshipping", "print_on_demand",
  // Genérico
  "marketplace", "multi_category", "others"
];

@Injectable()
export class UpdateMerchantThemeUseCase {
  private readonly logger = new Logger(UpdateMerchantThemeUseCase.name);

  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repo: MerchantRepository) {}

  async execute(merchantId: string, theme: Partial<MerchantTheme>): Promise<MerchantTheme> {
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
      throw new BadRequestException("invalid_theme");
    }
    const profile = await this.repo.getProfile(merchantId);
    if (!profile) throw new NotFoundException("merchant_not_found");
    const patch = Object.fromEntries(Object.entries(theme).filter(([, value]) => value !== undefined));
    const next: MerchantTheme = {
      ...DEFAULT_MERCHANT_THEME,
      ...((profile.plan === "BOTH" || profile.plan === "STORE_ONLY") ? profile.storeSettings?.styles ?? {} : {}),
      ...(profile.theme ?? {}),
      ...patch
    };

    validateMerchantTheme(next);

    return this.repo.updateTheme(merchantId, next);
  }

  async executeCategory(merchantId: string, storeCategory: string): Promise<{ storeCategory: string }> {
    if (!VALID_STORE_CATEGORIES.includes(storeCategory) && !isValidStoreCategory(storeCategory)) {
      throw new Error(`Invalid store category: ${storeCategory}`);
    }
    await this.repo.updateStoreCategory(merchantId, storeCategory);
    return { storeCategory };
  }

  async getStoreSettings(merchantId: string) {
    return this.repo.getStoreSettings(merchantId);
  }

  async updateStoreSettings(merchantId: string, settings: Record<string, unknown>) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new BadRequestException("invalid_store_settings");
    if (settings.budget !== undefined) {
      const budget = settings.budget as Record<string, unknown>;
      if (!budget || typeof budget !== "object" || Array.isArray(budget) || typeof budget.enabled !== "boolean") {
        throw new BadRequestException("invalid_budget_settings");
      }
      if (budget.email !== undefined && (typeof budget.email !== "string" || budget.email.length > 254 || (budget.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(budget.email.trim())))) throw new BadRequestException("invalid_budget_email");
      if (budget.whatsapp !== undefined && (typeof budget.whatsapp !== "string" || budget.whatsapp.length > 32 || (budget.whatsapp.trim() && !/^\d{10,15}$/.test(budget.whatsapp.replace(/\D/g, ""))))) throw new BadRequestException("invalid_budget_whatsapp");
      settings = { ...settings, budget: {
        enabled: budget.enabled,
        ...(typeof budget.email === "string" ? { email: budget.email.trim() } : {}),
        ...(typeof budget.whatsapp === "string" ? { whatsapp: budget.whatsapp.replace(/\D/g, "") } : {}),
      } };
    }
    return this.repo.updateStoreSettings(merchantId, settings as any);
  }
}
