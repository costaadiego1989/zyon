import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConversationShell from "@/components/ConversationShell";
import { OrganizationSchema, WebSiteSchema } from "@/components/StructuredData";
import { GoogleTagManager } from "@/components/GoogleTagManager";
import { getDemoMerchant } from "@/lib/demo-merchant";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stores.zyon.com";

type Params = { slug: string };
type SearchParams = { order?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const merchant = getDemoMerchant(slug);
  const name = merchant?.name ?? "Zyon Store";
  const description =
    merchant?.description ??
    "Loja conversacional com atendimento por IA e checkout integrado.";
  return {
    title: {
      default: name,
      template: `%s | ${name}`,
    },
    description,
    openGraph: {
      title: name,
      description,
      type: "website",
      siteName: name,
      url: `${SITE_URL}/store/${slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
      },
    },
    alternates: {
      canonical: `${SITE_URL}/store/${slug}`,
    },
  };
}

export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const { order } = await searchParams;
  const merchant = getDemoMerchant(slug);
  if (!merchant) {
    notFound();
  }

  const m = merchant!;

  const themeCss = `
    :root {
      --color-primary: ${m.theme.primary};
      --color-secondary: ${m.theme.secondary};
      --font-heading: ${m.theme.heading};
      --font-body: ${m.theme.body};
    }
  `;

  const pageUrl = `${SITE_URL}/store/${slug}`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      <OrganizationSchema
        name={m.name}
        url={pageUrl}
        logo={m.logo}
        description={m.description}
      />
      <WebSiteSchema name={m.name} url={pageUrl} />
      <GoogleTagManager gtmId={m.gtmId} />
      <div className="store-layout">
        <header className="store-header">
          <span className="store-header__brand">{m.name}</span>
        </header>
        <main className="store-main">
          <ConversationShell
            storeName={m.name}
            returnOrderId={order}
          />
        </main>
      </div>
    </>
  );
}