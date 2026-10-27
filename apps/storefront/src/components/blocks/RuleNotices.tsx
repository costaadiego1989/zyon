type RuleNotice = {
  ruleId?: string;
  kind?: string;
  gap?: number;
  reachable?: boolean;
  message: string;
};

export default function RuleNotices({ notices, live = false }: {
  notices?: RuleNotice[];
  live?: boolean;
}) {
  if (!notices?.length) return null;
  return <div data-aacp-rule-notices role={live ? "status" : undefined} aria-live={live ? "polite" : undefined}
    style={{ display: "grid", gap: 8, margin: "12px 0" }}>
    {notices.map((notice, index) => {
      const applied = /aplicad[oa]|frete gr[aá]tis/i.test(notice.message);
      const isCoupon = notice.kind === "coupon" || /cupom/i.test(notice.message);
      const label = applied ? "BENEFÍCIO ATIVO" : notice.reachable ? "QUASE LÁ" : isCoupon ? "CUPOM DISPONÍVEL" : "CONDIÇÃO ESPECIAL";
      const accent = applied ? "var(--aacp-accent)" : "var(--aacp-fg)";
      return <div key={notice.ruleId ?? `${notice.kind ?? "notice"}-${index}`}
        style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: 0, padding: "11px 12px", borderRadius: 10,
          border: "1px solid color-mix(in srgb, var(--aacp-accent) 34%, var(--aacp-line))",
          background: "linear-gradient(135deg, color-mix(in srgb, var(--aacp-accent) 11%, var(--aacp-surface-2)), var(--aacp-surface-2))",
          color: "var(--aacp-fg)", overflowWrap: "anywhere" }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, flex: "none", borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--aacp-accent) 18%, transparent)", color: "var(--aacp-accent)", fontWeight: 800 }}>
          {applied ? "✓" : isCoupon ? "%" : "✦"}
        </span>
        <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
          <span style={{ color: accent, fontSize: 10, fontWeight: 800, letterSpacing: ".06em" }}>{label}</span>
          <span style={{ fontSize: 13, lineHeight: 1.45 }}>{notice.message}</span>
        </span>
      </div>;
    })}
  </div>;
}
