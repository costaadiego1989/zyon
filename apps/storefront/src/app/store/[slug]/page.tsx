import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConversationShell from "@/components/ConversationShell";
import { WidgetConfigProvider } from "@/components/WidgetConfigProvider";
import { CartProvider } from "@/lib/cart-store";
import { OrganizationSchema, WebSiteSchema, BreadcrumbListSchema, ProductSchema } from "@/components/StructuredData";
import { GoogleTagManager } from "@/components/GoogleTagManager";
import { FacebookPixel, TiktokPixel } from "@/components/PixelTrackers";
import { getDemoMerchant } from "@/lib/demo-merchant";
import { fetchStoreConfig, fetchStoreStories } from "@/lib/api/server-client";
import { fetchProductContent } from "@/lib/api/product-content";
import { DemoEmbedBridge } from "@/components/DemoEmbedBridge";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stores.zyon.com";

function readableOnAccent(accent: string | undefined): string {
  const match = accent?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return "#f8f8f8";
  const hex = match[1].length === 3
    ? match[1].split("").map((part) => part + part).join("")
    : match[1];
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(channel(0)) + 0.7152 * linear(channel(2)) + 0.0722 * linear(channel(4));
  return luminance > 0.43 ? "#171719" : "#f8f8f8";
}
type Params = { slug: string };
type SearchParams = {
  order?: string;
  /** Wave 2 (advanced-product-layout): open the rich product in the agent
   *  history. Accepts both `?show=content&product=<id>` (preferred)
   *  and the older `?show=product&productId=<id>` alias. */
  show?: string;
  product?: string;
  productId?: string;
};

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams?: Promise<SearchParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  const config = await fetchStoreConfig(slug);
  const merchant = config ? null : getDemoMerchant(slug);
  const name = config?.name ?? merchant?.name ?? "Zyon Store";
  const seo = config?.storeSettings?.seo;
  const sharedProductId = (() => {
    const wantsRich = query?.show === "content" || query?.show === "product" || query?.show === "rich";
    const candidate = query?.product ?? query?.productId;
    return wantsRich && typeof candidate === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(candidate) ? candidate : null;
  })();
  const productContent = sharedProductId ? await fetchProductContent(slug, sharedProductId) : null;
  const purchase = productContent?.purchase;
  const description =
    purchase?.description ??
    seo?.description ??
    config?.description ??
    merchant?.description ??
    "Loja conversacional com atendimento por IA e checkout integrado.";
  const title = purchase?.productName ?? seo?.title ?? name;
  const keywords = seo?.keywords?.join(", ");
  const productImage = purchase?.images?.find((image) => image.src)?.src;
  const logo = productImage ?? seo?.ogImage ?? config?.logo ?? merchant?.logo;
  const canonicalUrl = sharedProductId
    ? `${SITE_URL}/store/${encodeURIComponent(slug)}?show=content&product=${encodeURIComponent(sharedProductId)}`
    : seo?.canonicalUrl ?? `${SITE_URL}/store/${slug}`;
  const twitterCard = (seo?.twitterCard ?? "summary_large_image") as any;

  return {
    title: {
      default: title,
      template: `%s | ${name}`,
    },
    description,
    keywords,
    themeColor: config?.theme.accentColor,
    category: config?.storeCategory,
    openGraph: {
      title: seo?.ogTitle ?? title,
      description: seo?.ogDescription ?? description,
      type: sharedProductId ? "article" : "website",
      siteName: name,
      url: canonicalUrl,
      locale: "pt_BR",
      images: logo ? [{ url: logo, width: 1200, height: 630, alt: purchase?.productName ?? name }] : [],
    },
    twitter: {
      card: twitterCard,
      title: seo?.ogTitle ?? title,
      description: seo?.ogDescription ?? description,
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
      canonical: canonicalUrl,
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
  const { order, show, product, productId } = await searchParams;

  const config = await fetchStoreConfig(slug);
  const stories = config?.stories ?? await fetchStoreStories(slug);
  const merchant = config ? null : getDemoMerchant(slug);

  if (!config && !merchant) {
    notFound();
  }

  // Wave 2 (advanced-product-layout): when the page loads with
  // `?show=content&product=<id>` (or the older `?show=product&productId=<id>`
  // alias) the chat shell fetches the same public, flag-gated representation
  // used by a product card. The buyer remains in a single agentic journey.
  const richProductId = (() => {
    if (!show) return null;
    const wantsRich = show === "content" || show === "product" || show === "rich";
    if (!wantsRich) return null;
    return product ?? productId ?? null;
  })();
  const sharedProduct = richProductId ? await fetchProductContent(slug, richProductId) : null;
  const sharedPurchase = sharedProduct?.purchase;
  const sharedProductUrl = richProductId
    ? `${SITE_URL}/store/${encodeURIComponent(slug)}?show=content&product=${encodeURIComponent(richProductId)}`
    : undefined;

  const name = config?.name ?? merchant!.name;
  const logo = config?.logo ?? merchant?.logo;
  const seoConfig = config?.storeSettings?.seo;
  const description =
    seoConfig?.description ??
    merchant?.description ??
    "Loja conversacional com atendimento por IA e checkout integrado.";
  const gtmId = config?.storeSettings?.gtm?.gtmId ?? merchant?.gtmId;
  const fbPixelId = config?.storeSettings?.gtm?.pixelIds?.facebook;
  const tiktokPixelId = config?.storeSettings?.gtm?.pixelIds?.tiktok;

  const mode = config?.theme?.mode;
  const modeDefaults = mode === "dark"
    ? { bg: "#09090b", text: "#fafafa", surface: "#18181b", border: "#27272a", muted: "#71717a" }
    : mode === "grey"
    ? { bg: "#191919", text: "#fafafa", surface: "#262626", border: "#333333", muted: "#a1a1aa" }
    : null; 

  const themeColors = config
    ? {
        primary: config.theme.accentColor,
        secondary: config.theme.secondaryColor ?? config.theme.accentColor,
        heading: config.theme.fontDisplay ?? config.theme.fontFamily,
        body: config.theme.fontFamily,
        backgroundColor: modeDefaults?.bg ?? config.theme.backgroundColor,
        textColor: modeDefaults?.text ?? config.theme.textColor,
        surfaceColor: modeDefaults?.surface ?? config.theme.surfaceColor,
        surfaceElevatedColor: modeDefaults?.surface ?? config.theme.surfaceElevatedColor,
        borderColor: modeDefaults?.border ?? config.theme.borderColor,
        borderRadius: config.theme.borderRadius,
        density: config.theme.density,
        backgroundImageUrl: config.theme.backgroundImageUrl,
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

  const derivedColors = themeColors.backgroundColor && themeColors.textColor
    ? deriveColors(themeColors.backgroundColor, themeColors.textColor)
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
      --aacp-on-accent: ${readableOnAccent(themeColors.primary)};
      ${themeColors.backgroundColor ? `--aacp-bg: ${themeColors.backgroundColor};` : ""}
      ${themeColors.backgroundColor ? `--aacp-shell-bg: ${themeColors.backgroundColor};` : ""}
      ${themeColors.backgroundColor ? `--aacp-panel-bg: ${themeColors.backgroundColor};` : ""}
      --aacp-header-bg: ${modeDefaults?.surface ?? "#ffffff"};
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
      ${themeColors.borderRadius != null ? `--aacp-radius: ${themeColors.borderRadius}px;` : ""}
      ${modeDefaults?.muted ? `--aacp-muted: ${modeDefaults.muted};` : ""}
      ${themeColors.backgroundImageUrl ? `--aacp-chat-bg-image: url(${themeColors.backgroundImageUrl});` : ""}
    }
  `;

  const pageUrl = `${SITE_URL}/store/${slug}`;
  const socialLinks = [
    config?.storeSettings?.social?.instagram,
    config?.storeSettings?.social?.facebook,
    config?.storeSettings?.social?.linkedin,
  ].filter(Boolean) as string[];

  const fontFamilies = [config?.theme.fontFamily, config?.theme.fontDisplay]
    .filter(Boolean)
    .map((f) => f!.split(",")[0].trim().replace(/'/g, ""))
    .filter((f) => f && !f.includes("system-ui") && !f.includes("ui-sans-serif") && !f.includes("sans-serif") && !f.includes("serif") && !f.includes("monospace"));
  const uniqueFonts = [...new Set(fontFamilies)];
  const googleFontsUrl = uniqueFonts.length > 0
    ? `https://fonts.googleapis.com/css2?${uniqueFonts.map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`).join("&")}&display=swap`
    : null;

  return (
    <>
      {googleFontsUrl && (
        <link rel="stylesheet" href={googleFontsUrl} />
      )}
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      <style dangerouslySetInnerHTML={{ __html: `
        .storefront-shell {
          display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden;
          background: var(--aacp-bg);
          color:var(--aacp-fg); font-family:var(--aacp-font);
          ${themeColors.density === "compact" ? "max-width:480px; margin:0 auto;" : themeColors.density === "comfortable" ? "max-width:680px; margin:0 auto;" : ""}
        }
        ${themeColors.backgroundImageUrl ? `
        body {
          background: var(--aacp-chat-bg-image) center/cover no-repeat fixed;
          background-color: var(--aacp-bg);
        }
        .storefront-shell {
          background: transparent;
        }
        .storefront-shell header,
        .storefront-shell [role="main"],
        .storefront-shell form,
        .storefront-shell > div:last-child {
          background: color-mix(in srgb, var(--aacp-bg) 88%, transparent);
          backdrop-filter: blur(8px);
        }
        ` : ""}
      `}} />
      <OrganizationSchema
        name={name}
        url={pageUrl}
        logo={logo}
        description={description}
        sameAs={socialLinks}
      />
      <WebSiteSchema name={name} url={pageUrl} />
      {sharedPurchase?.priceReais != null ? (
        <ProductSchema
          name={sharedPurchase.productName}
          description={sharedPurchase.description ?? undefined}
          image={sharedPurchase.images.find((image) => image.src)?.src}
          price={Math.round(sharedPurchase.priceReais * 100)}
          currency={sharedPurchase.currency ?? "BRL"}
          availability={sharedPurchase.variants.some((variant) => variant.available)}
          url={sharedProductUrl}
        />
      ) : null}
      <BreadcrumbListSchema
        items={[
          { name: "Início", url: SITE_URL },
          { name, url: pageUrl },
        ]}
      />
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {fbPixelId && <FacebookPixel pixelId={fbPixelId} />}
      {tiktokPixelId && <TiktokPixel pixelId={tiktokPixelId} />}
      {slug === "demo" && config?.merchantId ? <DemoEmbedBridge /> : null}
      {/* suppressHydrationWarning: zoom/reader browser extensions inject
          data-original-width + inline max-width on this shell before React
          hydrates. That mutation is outside our control. */}
      <div className="storefront-shell" suppressHydrationWarning>
        <WidgetConfigProvider merchantId={config?.merchantId}>
          <CartProvider merchantId={config?.merchantId}>
            <ConversationShell
              storeName={name}
              logo={logo}
              returnOrderId={order}
              agentName={config?.agentName}
              agentGreeting={config?.agentGreeting}
              agentAvatarUrl={config?.theme?.agentAvatarUrl}
              quickReplies={config?.quickReplies}
              merchantId={config?.merchantId}
              merchantSlug={slug}
              storeSettings={config?.storeSettings}
              initialStories={stories}
              themeMode={config?.theme?.mode}
              showBranding={config?.showBranding}
              agentMode={config?.agentMode}
              agentInitialDelaySeconds={config?.agentInitialDelaySeconds}
              initialRichProductId={richProductId ?? undefined}
            />
          </CartProvider>
        </WidgetConfigProvider>
      </div>
    </>
  );
}
