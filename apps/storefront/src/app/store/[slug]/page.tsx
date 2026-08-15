import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConversationShell from "@/components/ConversationShell";
import { OrganizationSchema, WebSiteSchema } from "@/components/StructuredData";
import { GoogleTagManager } from "@/components/GoogleTagManager";
import { getDemoMerchant } from "@/lib/demo-merchant";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stores.zyon.com";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

type Params = { slug: string };
type SearchParams = { order?: string };

interface StoreConfig {
  merchantId: string;
  name: string;
  logo?: string;
  theme: {
    accentColor: string;
    secondaryColor?: string;
    textColor: string;
    backgroundColor: string;
    fontFamily: string;
    logoUrl?: string;
    agentAvatarUrl?: string;
    surfaceColor?: string;
    surfaceElevatedColor?: string;
    borderColor?: string;
  };
  agentName?: string;
  quickReplies?: string[];
}

async function fetchStoreConfig(slug: string): Promise<StoreConfig | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/storefront/${slug}/config`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as StoreConfig;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const config = await fetchStoreConfig(slug);
  const merchant = config ? null : getDemoMerchant(slug);
  const name = config?.name ?? merchant?.name ?? "Zyon Store";
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

  // Try real API first, fallback to demo fixture
  const config = await fetchStoreConfig(slug);
  const merchant = config ? null : getDemoMerchant(slug);

  if (!config && !merchant) {
    notFound();
  }

  const name = config?.name ?? merchant!.name;
  const logo = config?.logo ?? merchant?.logo;
  const description =
    merchant?.description ??
    "Loja conversacional com atendimento por IA e checkout integrado.";
  const gtmId = merchant?.gtmId;

  // Theme: merge from API config or demo merchant
  const themeColors = config
    ? {
        primary: config.theme.accentColor,
        secondary: config.theme.secondaryColor ?? config.theme.accentColor,
        heading: config.theme.fontFamily,
        body: config.theme.fontFamily,
        backgroundColor: config.theme.backgroundColor,
        textColor: config.theme.textColor,
        surfaceColor: config.theme.surfaceColor,
        surfaceElevatedColor: config.theme.surfaceElevatedColor,
        borderColor: config.theme.borderColor,
      }
    : {
        primary: merchant!.theme.primary,
        secondary: merchant!.theme.secondary,
        heading: merchant!.theme.heading,
        body: merchant!.theme.body,
        backgroundColor: undefined,
        textColor: undefined,
        surfaceColor: undefined,
        surfaceElevatedColor: undefined,
        borderColor: undefined,
      };

  const themeCss = `
    :root {
      --color-primary: ${themeColors.primary};
      --color-secondary: ${themeColors.secondary};
      --font-heading: ${themeColors.heading};
      --font-body: ${themeColors.body};
      ${themeColors.backgroundColor ? `--aacp-bg: ${themeColors.backgroundColor};` : ""}
      ${themeColors.textColor ? `--aacp-fg: ${themeColors.textColor};` : ""}
      ${themeColors.surfaceColor ? `--aacp-surface: ${themeColors.surfaceColor};` : ""}
      --aacp-accent: ${themeColors.primary};
      ${config?.theme.fontFamily ? `--aacp-font: ${config.theme.fontFamily};` : ""}
      ${config?.theme.surfaceElevatedColor ? `--aacp-surface-elevated: ${config.theme.surfaceElevatedColor};` : ""}
      ${config?.theme.borderColor ? `--aacp-border-color: ${config.theme.borderColor};` : ""}
    }
  `;

  const pageUrl = `${SITE_URL}/store/${slug}`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      <OrganizationSchema
        name={name}
        url={pageUrl}
        logo={logo}
        description={description}
      />
      <WebSiteSchema name={name} url={pageUrl} />
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      <ConversationShell
        storeName={name}
        logo={logo}
        returnOrderId={order}
        agentName={config?.agentName}
      />
    </>
  );
}