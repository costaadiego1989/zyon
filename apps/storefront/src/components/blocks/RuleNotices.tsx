export default function RuleNotices({ notices, live = false }: {
  notices?: Array<{ ruleId?: string; message: string }>;
  live?: boolean;
}) {
  if (!notices?.length) return null;
  return <div data-aacp-rule-notices role={live ? "status" : undefined} aria-live={live ? "polite" : undefined}
    style={{ display: "grid", gap: 8, margin: "12px 0" }}>
    {notices.map((notice, index) => <p key={notice.ruleId ?? index}
      style={{ margin: 0, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--aacp-line)",
        background: "var(--aacp-surface-2)", color: "var(--aacp-fg)", fontSize: 13, lineHeight: 1.5, overflowWrap: "anywhere" }}>
      {notice.message}
    </p>)}
  </div>;
}
