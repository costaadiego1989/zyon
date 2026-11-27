export function MerchantTrustBadges({ badges }: { badges?: readonly string[] }) {
  const labels = Array.isArray(badges) ? badges.filter(value => typeof value === "string" && value.trim()).slice(0, 4) : [];
  if (!labels.length) return null;
  return <ul aria-label="Informações da loja" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 12px",
    listStyle: "none", margin: 0, padding: "8px 12px", color: "var(--aacp-muted)", fontSize: 10, flexShrink: 0 }}>
    {labels.map((label, index) => <li key={index} style={{ maxWidth: "100%", overflowWrap: "anywhere" }}>{label}</li>)}
  </ul>;
}
