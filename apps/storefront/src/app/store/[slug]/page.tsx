import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConversationShell from "@/components/ConversationShell";
import { WidgetConfigProvider } from "@/components/WidgetConfigProvider";
import { CartProvider } from "@/lib/cart-store";
import { OrganizationSchema, WebSiteSchema, BreadcrumbListSchema } from "@/components/StructuredData";
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
  favicon?: string;
  description?: string;
  theme: {
    accentColor: string;
    secondaryColor?: string;
    textColor: string;
    backgroundColor: string;
    fontFamily: string;
    fontDisplay?: string;
    logoUrl?: string;
    agentAvatarUrl?: string;
    surfaceColor?: string;
    surfaceElevatedColor?: string;
    borderColor?: string;
  };
  agentName?: string;
  agentGreeting?: string;
  quickReplies?: string[];
  stories?: any[];
  storeCategory?: string;
  storeSettings?: {
    social?: { instagram?: string; facebook?: string; linkedin?: string; youtube?: string; googleMaps?: string };
    company?: { cnpj?: string; razaoSocial?: string; email?: string; phone?: string; businessHours?: string; address?: { city?: string; state?: string } };
    policies?: { privacy?: string; returns?: string; terms?: string; shipping?: string };
  };
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

async function fetchStoreStories(slug: string): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/storefront/${slug}/stories`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.categories ?? [];
  } catch {
    return [];
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
    config?.description ??
    merchant?.description ??
    "Loja conversacional com atendimento por IA e checkout integrado.";
  const logo = config?.logo ?? merchant?.logo;
  return {
    title: {
      default: name,
      template: `%s | ${name}`,
    },
    description,
    themeColor: config?.theme.accentColor,
    category: config?.storeCategory,
    openGraph: {
      title: name,
      description,
      type: "website",
      siteName: name,
      url: `${SITE_URL}/store/${slug}`,
      locale: "pt_BR",
      images: logo ? [{ url: logo, width: 1200, height: 630, alt: name }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description,
      images: logo ? [logo] : [],
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
    icons: config?.favicon ? { icon: config.favicon, apple: config.favicon } : undefined,
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
  const stories = config?.stories ?? await fetchStoreStories(slug);
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
        heading: config.theme.fontDisplay ?? config.theme.fontFamily,
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

  // Calculate derived colors from merchant theme (matching Pulse design)
  const deriveColors = (bgColor: string, textColor: string) => {
    return {
      surface: bgColor, // Use bg directly, add subtle variations via CSS
      surface2: `rgba(255, 255, 255, 0.05)`,
      surface3: `rgba(255, 255, 255, 0.08)`,
      card: `rgba(255, 255, 255, 0.05)`,
      line: `rgba(255, 255, 255, 0.1)`,
      lineStrong: `rgba(255, 255, 255, 0.12)`,
      insetBg: `rgba(255, 255, 255, 0.05)`,
      muted: `#8b8b95`,
      chip: `rgba(255, 255, 255, 0.05)`,
      sheet: `color-mix(in srgb, ${bgColor} 90%, ${textColor} 10%)`,
    };
  };

  const derivedColors = config?.theme.backgroundColor && config?.theme.textColor
    ? deriveColors(config.theme.backgroundColor, config.theme.textColor)
    : {
        surface: undefined,
        surface2: undefined,
        surface3: undefined,
        card: undefined,
        line: undefined,
        lineStrong: undefined,
        insetBg: undefined,
        muted: undefined,
        chip: undefined,
        sheet: undefined,
      };

  const themeCss = `
    :root {
      --color-primary: ${themeColors.primary};
      --color-secondary: ${themeColors.secondary};
      --font-heading: ${themeColors.heading};
      --font-body: ${themeColors.body};
      --aacp-accent: ${themeColors.primary};
      --aacp-accent-2: ${themeColors.secondary};
      --aacp-accent-strong: ${themeColors.primary};
      ${themeColors.backgroundColor ? `--aacp-bg: ${themeColors.backgroundColor};` : ""}
      ${themeColors.backgroundColor ? `--aacp-shell-bg: ${themeColors.backgroundColor};` : ""}
      ${themeColors.backgroundColor ? `--aacp-panel-bg: ${themeColors.backgroundColor};` : ""}
      ${derivedColors.surface ? `--aacp-surface: ${derivedColors.surface};` : ""}
      ${derivedColors.surface2 ? `--aacp-surface-2: ${derivedColors.surface2};` : ""}
      ${derivedColors.surface3 ? `--aacp-surface-3: ${derivedColors.surface3};` : ""}
      ${derivedColors.card ? `--aacp-card: ${derivedColors.card};` : ""}
      ${themeColors.textColor ? `--aacp-fg: ${themeColors.textColor};` : ""}
      ${derivedColors.line ? `--aacp-line: ${derivedColors.line};` : ""}
      ${derivedColors.lineStrong ? `--aacp-line-strong: ${derivedColors.lineStrong};` : ""}
      ${derivedColors.insetBg ? `--aacp-inset-bg: ${derivedColors.insetBg};` : ""}
      ${derivedColors.muted ? `--aacp-muted: ${derivedColors.muted};` : ""}
      ${derivedColors.chip ? `--aacp-chip: ${derivedColors.chip};` : ""}
      ${derivedColors.sheet ? `--aacp-sheet: ${derivedColors.sheet};` : ""}
      ${config?.theme.fontFamily ? `--aacp-font: ${config.theme.fontFamily};` : ""}
      ${config?.theme.fontDisplay ? `--aacp-font-display: ${config.theme.fontDisplay};` : config?.theme.fontFamily ? `--aacp-font-display: ${config.theme.fontFamily};` : ""}
      ${config?.theme.surfaceElevatedColor ? `--aacp-surface-elevated: ${config.theme.surfaceElevatedColor};` : ""}
      ${config?.theme.borderColor ? `--aacp-border-color: ${config.theme.borderColor};` : ""}
    }
  `;

  const pageUrl = `${SITE_URL}/store/${slug}`;
  const socialLinks = [
    config?.storeSettings?.social?.instagram,
    config?.storeSettings?.social?.facebook,
    config?.storeSettings?.social?.linkedin,
  ].filter(Boolean) as string[];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      <style dangerouslySetInnerHTML={{ __html: `
        .storefront-shell { display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden; background:var(--aacp-bg); color:var(--aacp-fg); font-family:var(--aacp-font); }
      `}} />
      <OrganizationSchema
        name={name}
        url={pageUrl}
        logo={logo}
        description={description}
        sameAs={socialLinks}
      />
      <WebSiteSchema name={name} url={pageUrl} />
      <BreadcrumbListSchema
        items={[
          { name: "Início", url: SITE_URL },
          { name, url: pageUrl },
        ]}
      />
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      <div className="storefront-shell">
        <WidgetConfigProvider merchantId={config?.merchantId}>
          <CartProvider merchantId={config?.merchantId}>
            <ConversationShell
              storeName={name}
              logo={logo}
              returnOrderId={order}
              agentName={config?.agentName}
              agentGreeting={config?.agentGreeting}
              quickReplies={config?.quickReplies}
              merchantId={config?.merchantId}
              merchantSlug={slug}
              storeSettings={config?.storeSettings}
              initialStories={stories}
            />
          </CartProvider>
        </WidgetConfigProvider>
      </div>
    </>
  );
}