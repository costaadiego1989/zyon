/**
 * Shared signup/onboarding options.
 * Single source of truth for the merchant profile fields collected at signup
 * AND during the onboarding wizard — keeps the two surfaces consistent and
 * lets new verticals (services, digital products, B2B, etc.) be added in one
 * place.
 */

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  emoji?: string;
}

export const STORE_CATEGORIES: SelectOption[] = [
  { value: "electronics", label: "Eletrônicos & Tecnologia", emoji: "💻" },
  { value: "fashion", label: "Moda & Vestuário", emoji: "👗" },
  { value: "beauty_health", label: "Beleza & Cosméticos", emoji: "💄" },
  { value: "food_beverage", label: "Alimentos & Bebidas", emoji: "🍽️" },
  { value: "home_decor", label: "Casa & Decoração", emoji: "🏠" },
  { value: "sports_fitness", label: "Esportes & Fitness", emoji: "🏋️" },
  { value: "pet", label: "Pet Shop", emoji: "🐾" },
  { value: "automotive", label: "Automotivo", emoji: "🚗" },
  { value: "gaming", label: "Games & Entretenimento", emoji: "🎮" },
  { value: "books_education", label: "Livros & Educação", emoji: "📚" },
  { value: "toys_kids", label: "Brinquedos & Infantil", emoji: "🧸" },
  { value: "jewelry_watches", label: "Joias & Relógios", emoji: "💎" },
  { value: "furniture", label: "Móveis", emoji: "🛋️" },
  { value: "groceries", label: "Supermercado & Mercearia", emoji: "🛒" },
  { value: "pharmacy", label: "Farmácia", emoji: "🏥" },
  { value: "office_supplies", label: "Papelaria & Escritório", emoji: "📎" },
  { value: "music_instruments", label: "Instrumentos Musicais", emoji: "🎸" },
  { value: "digital_products", label: "Produtos Digitais", emoji: "📱" },
  { value: "services", label: "Serviços", emoji: "🔧" },
  { value: "saas_software", label: "SaaS & Software", emoji: "☁️" },
  { value: "courses_education", label: "Cursos & Infoprodutos", emoji: "🎓" },
  { value: "subscriptions", label: "Assinaturas & Recorrência", emoji: "🔄" },
  { value: "consulting", label: "Consultoria", emoji: "💼" },
  { value: "freelance", label: "Freelance & Serviços Criativos", emoji: "🎨" },
  { value: "events_tickets", label: "Eventos & Ingressos", emoji: "🎟️" },
  { value: "handmade_artisan", label: "Artesanato & Handmade", emoji: "🧶" },
  { value: "adult", label: "Adulto & Sensual", emoji: "🔞" },
  { value: "cannabis_cbd", label: "Cannabis & CBD", emoji: "🌿" },
  { value: "luxury", label: "Luxo & Premium", emoji: "✨" },
  { value: "sustainability_eco", label: "Sustentável & Eco", emoji: "♻️" },
  { value: "religious", label: "Religioso & Espiritual", emoji: "🕊️" },
  { value: "industrial_b2b", label: "Industrial & B2B", emoji: "🏭" },
  { value: "wholesale", label: "Atacado", emoji: "📦" },
  { value: "dropshipping", label: "Dropshipping", emoji: "🚀" },
  { value: "print_on_demand", label: "Print on Demand", emoji: "🖨️" },
  { value: "marketplace", label: "Marketplace", emoji: "🏪" },
  { value: "multi_category", label: "Multi-categoria", emoji: "🗂️" },
  { value: "others", label: "Outros", emoji: "📋" },
];

export const ROLES: SelectOption[] = [
  { value: "owner", label: "Proprietário(a)" },
  { value: "ceo", label: "CEO / Diretor(a)" },
  { value: "manager", label: "Gerente" },
  { value: "developer", label: "Desenvolvedor(a)" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Outro" },
];

export const VOLUMES: SelectOption[] = [
  { value: "lt_50", label: "Até 50 pedidos" },
  { value: "50_500", label: "50–500 pedidos" },
  { value: "gt_500", label: "500+ pedidos" },
];
