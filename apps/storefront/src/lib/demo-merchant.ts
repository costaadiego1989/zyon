export type Product = {
  id: string;
  name: string;
  price: number;
  image?: string;
};

export type Merchant = {
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  logo?: string;
  gtmId?: string;
  theme: {
    primary: string;
    secondary: string;
    heading: string;
    body: string;
  };
  products: Product[];
};

export const DEMO_MERCHANT: Merchant = {
  slug: "demo",
  name: "Demo Boutique",
  tagline: "Curated pieces, conversation-first.",
  description: "Loja conversacional de moda e lifestyle com curadoria humana e atendimento por IA.",
  logo: undefined,
  gtmId: undefined,
  theme: {
    primary: "#5b3df5",
    secondary: "#ff6b6b",
    heading:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  products: [
    {
      id: "p1",
      name: "Linen Tee",
      price: 49.9,
      image: undefined,
    },
    {
      id: "p2",
      name: "Everyday Sneaker",
      price: 199.0,
      image: undefined,
    },
    {
      id: "p3",
      name: "Wool Beanie",
      price: 29.5,
      image: undefined,
    },
    {
      id: "p4",
      name: "Canvas Tote",
      price: 39.0,
      image: undefined,
    },
    {
      id: "p5",
      name: "Ceramic Mug",
      price: 18.0,
      image: undefined,
    },
    {
      id: "p6",
      name: "Scented Candle",
      price: 24.0,
      image: undefined,
    },
  ],
};

export function getDemoMerchant(slug: string): Merchant | null {
  if (slug !== "demo") return null;
  return DEMO_MERCHANT;
}