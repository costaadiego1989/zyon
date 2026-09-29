export const MERCHANT_EMAIL_HEADER_SLOT = "<!-- zyon:merchant-email-header -->";
export const MERCHANT_EMAIL_FOOTER_SLOT = "<!-- zyon:merchant-email-footer -->";

type RecordValue = Record<string, unknown>;

export interface MerchantEmailBranding {
  merchantName: string;
  logoUrl?: string;
  cnpj?: string;
  accentColor?: string;
  social?: {
    instagram?: string;
    facebook?: string;
    linkedin?: string;
    youtube?: string;
  };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

function asRecord(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function safeAccentColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : undefined;
}

function safeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : undefined;
}

/** Converts persisted merchant JSON into a narrowly scoped, safe email identity. */
export function resolveMerchantEmailBranding(input: {
  name: string;
  theme?: unknown;
  storeSettings?: unknown;
}): MerchantEmailBranding {
  const theme = asRecord(input.theme);
  const settings = asRecord(input.storeSettings);
  const styles = asRecord(settings?.styles);
  const company = asRecord(settings?.company);
  const social = asRecord(settings?.social);

  return {
    merchantName: safeText(input.name) ?? "Sua loja",
    logoUrl: safeHttpsUrl(theme?.logoUrl) ?? safeHttpsUrl(styles?.logoUrl),
    cnpj: safeText(company?.cnpj),
    accentColor: safeAccentColor(theme?.accentColor) ?? safeAccentColor(styles?.accentColor),
    social: {
      instagram: safeHttpsUrl(social?.instagram),
      facebook: safeHttpsUrl(social?.facebook),
      linkedin: safeHttpsUrl(social?.linkedin),
      youtube: safeHttpsUrl(social?.youtube),
    },
  };
}

function header(brand: MerchantEmailBranding): string {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" width="148" alt="${escapeHtml(brand.merchantName)}" style="display:block;max-width:148px;height:auto;margin:0 auto 12px;border:0;outline:none;text-decoration:none">`
    : "";
  const accent = brand.accentColor ?? "#205c45";
  return `<div style="text-align:center;padding:4px 0 20px">${logo}<p style="margin:0;color:${accent};font:700 13px/1.4 Arial,sans-serif;letter-spacing:.02em">${escapeHtml(brand.merchantName)}</p></div>`;
}

function footer(brand: MerchantEmailBranding): string {
  const links = [
    ["Instagram", brand.social?.instagram],
    ["Facebook", brand.social?.facebook],
    ["LinkedIn", brand.social?.linkedin],
    ["YouTube", brand.social?.youtube],
  ].flatMap(([label, href]) => href ? [`<a href="${escapeHtml(href)}" style="color:#52665b;text-decoration:underline">${label}</a>`] : []);
  const cnpj = brand.cnpj ? `<p style="margin:6px 0 0">CNPJ: ${escapeHtml(brand.cnpj)}</p>` : "";
  const social = links.length ? `<p style="margin:10px 0 0">${links.join(" &nbsp;&middot;&nbsp; ")}</p>` : "";
  return `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #dce5df;text-align:center;color:#66756d;font:12px/1.55 Arial,sans-serif"><p style="margin:0">&copy; ${new Date().getFullYear()} ${escapeHtml(brand.merchantName)}</p>${cnpj}${social}<p style="margin:10px 0 0">Mensagem transacional da loja.</p></div>`;
}

/**
 * Applies trusted merchant identity to a complete email document. New templates
 * use explicit slots; legacy merchant templates are safely augmented until
 * their body markup is migrated to the shared shell.
 */
export function applyMerchantEmailBranding(html: string, brand: MerchantEmailBranding): string {
  const brandedHeader = header(brand);
  const brandedFooter = footer(brand);
  let output = html
    .replace(MERCHANT_EMAIL_HEADER_SLOT, brandedHeader)
    .replace(MERCHANT_EMAIL_FOOTER_SLOT, brandedFooter);

  if (!html.includes(MERCHANT_EMAIL_HEADER_SLOT)) {
    output = /<body\b[^>]*>/i.test(output)
      ? output.replace(/<body\b[^>]*>/i, (match) => `${match}${brandedHeader}`)
      : `${brandedHeader}${output}`;
  }
  if (!html.includes(MERCHANT_EMAIL_FOOTER_SLOT)) {
    output = /<\/body>/i.test(output)
      ? output.replace(/<\/body>/i, `${brandedFooter}</body>`)
      : `${output}${brandedFooter}`;
  }
  return output;
}
