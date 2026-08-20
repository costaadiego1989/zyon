import type { FC } from "react";
import { useConsent } from "./useConsent.js";

interface ConsentBannerProps {
  sessionId: string;
  globalUserId: string;
  apiOrigin: string;
  embedToken?: string;
  onConsentChanged?: (optedIn: boolean) => void;
}

/**
 * ConsentBanner — LGPD-compliant consent notification.
 *
 * Feature 4: Customer Intent Memory
 * Displays banner at top of chat, captures buyer intent for personalization.
 * Dismissible, persisted in localStorage (shows only once).
 *
 * Portuguese text per merchant region (Brazil).
 */
export const ConsentBanner: FC<ConsentBannerProps> = ({
  sessionId,
  globalUserId,
  apiOrigin,
  embedToken,
  onConsentChanged,
}) => {
  const { showBanner, onAccept, onReject, isLoading, error } = useConsent(
    sessionId,
    globalUserId,
    apiOrigin,
    embedToken
  );

  if (!showBanner) return null;

  const handleAccept = async () => {
    await onAccept();
    onConsentChanged?.(true);
  };

  const handleReject = async () => {
    await onReject();
    onConsentChanged?.(false);
  };

  return (
    <div
      className="aacp-consent-banner"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 14px",
        marginBottom: "14px",
        borderRadius: "10px",
        background: "var(--chip, #f5f5f5)",
        border: "1px solid var(--bd, #e0e0e0)",
        fontSize: "13px",
        color: "var(--tx, #000)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: "0 0 6px 0", lineHeight: 1.4 }}>
          Esta loja usa IA para personalizar sua experiência de compra.
        </p>
        {error && (
          <p style={{ margin: "0", fontSize: "11px", color: "#ff4c6c" }}>
            Erro: {error}
          </p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          flex: "none",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={handleReject}
          disabled={isLoading}
          className="aacp-consent-button--secondary"
          style={{
            padding: "8px 12px",
            borderRadius: "7px",
            border: "1px solid var(--bd, #e0e0e0)",
            background: "transparent",
            color: "var(--tx, #000)",
            fontSize: "12px",
            fontWeight: 500,
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading ? 0.6 : 1,
            transition: "opacity 0.2s",
            fontFamily: "inherit",
          }}
        >
          Não, obrigado
        </button>

        <button
          type="button"
          onClick={handleAccept}
          disabled={isLoading}
          className="aacp-consent-button--primary"
          style={{
            padding: "8px 12px",
            borderRadius: "7px",
            border: "none",
            background: "var(--aacp-accent, #0f766e)",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 600,
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading ? 0.6 : 1,
            transition: "opacity 0.2s",
            fontFamily: "inherit",
          }}
        >
          {isLoading ? "..." : "Aceitar"}
        </button>
      </div>
    </div>
  );
};
