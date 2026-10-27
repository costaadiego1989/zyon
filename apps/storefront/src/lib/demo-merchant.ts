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
  name: "Zyon Demo Store",
  tagline: "Conversational commerce, powered by AI.",
  description: "Loja conversacional com curadoria de produtos e atendimento por IA.",
  logo: undefined,
  gtmId: undefined,
  theme: {
    primary: "#0f766e",
    secondary: "#1e40af",
    heading: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
    body: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
  },
  products: [
    {
      id: "p1",
      name: "Premium Headphones",
      price: 149.9,
      image: undefined,
    },
    {
      id: "p2",
      name: "Wireless Charger",
      price: 79.0,
      image: undefined,
    },
    {
      id: "p3",
      name: "USB-C Cable",
      price: 19.5,
      image: undefined,
    },
    {
      id: "p4",
      name: "Phone Stand",
      price: 24.0,
      image: undefined,
    },
    {
      id: "p5",
      name: "Screen Protector",
      price: 12.0,
      image: undefined,
    },
    {
      id: "p6",
      name: "Device Case",
      price: 34.0,
      image: undefined,
    },
  ],
};

export function getDemoMerchant(slug: string): Merchant | null {
  if (slug !== "demo") return null;
  return DEMO_MERCHANT;
}