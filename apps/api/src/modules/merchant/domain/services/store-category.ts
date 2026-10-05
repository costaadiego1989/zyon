/**
 * Store categories persisted by the merchant profile. Keep legacy values while
 * accepting the current dashboard catalog so a selected segment is never lost
 * between onboarding and managed-store creation.
 */
export const VALID_STORE_CATEGORIES = new Set([
  "electronics", "fashion", "beauty", "beauty_health", "home_decor", "sports",
  "food_beverage", "health", "pet", "automotive", "gaming", "books_education",
  "toys_kids", "jewelry_watches", "furniture", "groceries", "pharmacy",
  "office_supplies", "music_instruments", "digital_products", "services",
  "saas_software", "courses_education", "subscriptions", "consulting", "freelance",
  "events_tickets", "handmade_artisan", "adult", "cannabis_cbd", "luxury",
  "sustainability_eco", "religious", "industrial_b2b", "wholesale", "dropshipping",
  "print_on_demand", "marketplace", "multi_category", "others",
]);

export function isValidStoreCategory(value: string): boolean {
  return VALID_STORE_CATEGORIES.has(value);
}
