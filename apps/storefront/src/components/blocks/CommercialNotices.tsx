import { parseCommercialNotices, commercialNoticeLabel } from "@/lib/commercial-notices";

/** The server owns the decision and copy. This component only announces it. */
export default function CommercialNotices({ notices }: { notices?: unknown }) {
  const valid = parseCommercialNotices(notices);
  if (!valid.length) return null;
  return <div data-aacp-commercial-notices role="status" aria-live="polite"
    style={{ color: "var(--aacp-fg)", fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>
    {valid.map((notice, index) => <p key={`${notice.code}-${index}`} data-commercial-notice-code={notice.code} style={{ margin: "8px 0" }}>
      <strong>{commercialNoticeLabel(notice.code)}.</strong>{" "}{notice.message}
    </p>)}
  </div>;
}
