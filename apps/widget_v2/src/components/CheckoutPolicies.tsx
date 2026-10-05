import { useCheckoutStore } from "@/store/checkout-store";

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function CheckoutPolicies() {
  const policies = useCheckoutStore(state => state.policies);
  const links = [
    ["Privacidade da loja", safeUrl(policies?.privacyUrl)],
    ["Termos da loja", safeUrl(policies?.termsUrl)],
    ["Trocas e devoluções", safeUrl(policies?.refundUrl)],
    ["Envio e frete", safeUrl(policies?.shippingUrl)],
    ["Documentos da Zyon", "https://www.zyon-payments.com.br/privacidade"],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return <nav aria-label="Políticas do checkout" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: 16, padding: "0 12px", flex: "none", borderTop: "1px solid var(--aacp-line)", background: "var(--aacp-surface)", fontSize: 12 }}>
    {links.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: "var(--aacp-fg)", textDecoration: "underline", textUnderlineOffset: 3 }}>{label}</a>)}
  </nav>;
}
