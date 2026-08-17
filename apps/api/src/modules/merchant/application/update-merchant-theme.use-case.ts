import { Inject, Injectable , Logger} from "@nestjs/common";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../domain/ports/merchant-repository.port.js";
import { validateMerchantTheme } from "../domain/services/merchant-theme.validators.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

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

  async execute(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme> {
    const next: MerchantTheme = {
      ...DEFAULT_MERCHANT_THEME,
      ...(theme ?? {})
    };

    validateMerchantTheme(next);

    return this.repo.updateTheme(merchantId, next);
  }

  async executeCategory(merchantId: string, storeCategory: string): Promise<{ storeCategory: string }> {
    if (!VALID_STORE_CATEGORIES.includes(storeCategory)) {
      throw new Error(`Invalid store category: ${storeCategory}`);
    }
    await this.repo.updateStoreCategory(merchantId, storeCategory);
    return { storeCategory };
  }

  async getStoreSettings(merchantId: string) {
    return this.repo.getStoreSettings(merchantId);
  }

  async updateStoreSettings(merchantId: string, settings: Record<string, unknown>) {
    return this.repo.updateStoreSettings(merchantId, settings as any);
  }
}
