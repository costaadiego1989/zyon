import { notFound } from "next/navigation";
import ConversationShell from "@/components/ConversationShell";
import ProductCard from "@/components/ProductCard";
import { getDemoMerchant, type Product } from "@/lib/demo-merchant";

type Params = { slug: string };

async function fetchMerchantAndProducts(
  slug: string,
  fallback: { slug: string; name: string; tagline?: string },
): Promise<{
  name: string;
  tagline?: string;
  products: Product[];
}> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

  if (slug !== "demo") {
    return { name: fallback.name, tagline: fallback.tagline, products: [] };
  }

  try {
    const res = await fetch(`${base}/merchants/me/products`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        name: fallback.name,
        tagline: fallback.tagline,
        products: [],
      };
    }
    const data = (await res.json()) as { products?: Product[] };
    const list = (data.products ?? []).slice(0, 6);
    return {
      name: fallback.name,
      tagline: fallback.tagline,
      products: list,
    };
  } catch {
    return {
      name: fallback.name,
      tagline: fallback.tagline,
      products: [],
    };
  }
}

export default async function StorePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const merchant = getDemoMerchant(slug);
  if (!merchant) {
    notFound();
  }

  const m = merchant!;
  const { name, tagline, products } = await fetchMerchantAndProducts(
    m.slug,
    { slug: m.slug, name: m.name, tagline: m.tagline },
  );

  const demoProducts =
    products.length > 0 ? products : m.products.slice(0, 6);

  const themeCss = `
    :root {
      --color-primary: ${m.theme.primary};
      --color-secondary: ${m.theme.secondary};
      --font-heading: ${m.theme.heading};
      --font-body: ${m.theme.body};
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      <main
        style={{
          minHeight: "100vh",
          padding: "48px 24px 220px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <header
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginBottom: 32,
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--color-primary)",
            }}
          >
            Zyon Store
          </span>
          <h1
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {name}
          </h1>
          {tagline && (
            <p
              style={{
                fontSize: 18,
                color: "var(--color-fg-soft)",
                margin: 0,
              }}
            >
              {tagline}
            </p>
          )}
        </header>

        <section
          aria-label="Produtos"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 20,
          }}
        >
          {demoProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </section>
      </main>
      <ConversationShell storeName={name} />
    </>
  );
}