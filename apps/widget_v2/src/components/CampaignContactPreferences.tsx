import { useEffect, useMemo, useState } from "react";
import type { CheckoutSession } from "@/api/checkout-session";

type ContactChannel = "email" | "whatsapp";

const POLICY_VERSION = "checkout_campaign_contact_v1";
const channels: ContactChannel[] = ["email", "whatsapp"];

interface CampaignContactPreferencesProps {
  api: CheckoutSession | null;
  sessionId: string | null;
}

export function CampaignContactPreferences({ api, sessionId }: CampaignContactPreferencesProps) {
  const [savedChannels, setSavedChannels] = useState<Set<ContactChannel>>(() => new Set());
  const [selectedChannels, setSelectedChannels] = useState<Set<ContactChannel>>(() => new Set());
  const [loading, setLoading] = useState(Boolean(api && sessionId));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !sessionId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setNotice(null);
    void fetch(`${api.apiBaseUrl}/embed/checkout/consent/campaigns?session_id=${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${api.authToken}` },
    }).then(async (response) => {
      if (!response.ok) throw new Error("campaign_consent_load_failed");
      const payload = await response.json() as { channels?: unknown };
      const granted = new Set(
        Array.isArray(payload.channels)
          ? payload.channels.filter((channel): channel is ContactChannel => channel === "email" || channel === "whatsapp")
          : [],
      );
      if (!active) return;
      setSavedChannels(granted);
      setSelectedChannels(new Set(granted));
    }).catch(() => {
      if (active) setNotice("Não foi possível carregar suas preferências de contato.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, sessionId]);

  const hasChanges = useMemo(
    () => channels.some((channel) => savedChannels.has(channel) !== selectedChannels.has(channel)),
    [savedChannels, selectedChannels],
  );

  if (!api || !sessionId) return null;

  const toggleChannel = (channel: ContactChannel) => {
    setNotice(null);
    setSelectedChannels((current) => {
      const next = new Set(current);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  };

  const persist = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`${api.apiBaseUrl}/embed/checkout/consent/campaigns`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.authToken}` },
        body: JSON.stringify({ session_id: sessionId, policy_version: POLICY_VERSION, channels: channels.filter((channel) => selectedChannels.has(channel)) }),
      });
      if (!response.ok) throw new Error("campaign_consent_save_failed");
      setSavedChannels(new Set(selectedChannels));
      setNotice("Preferências de contato atualizadas.");
    } catch {
      setSelectedChannels(new Set(savedChannels));
      setNotice("Não foi possível atualizar suas preferências. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <details
      style={{
        flex: "none",
        marginTop: "8px",
        padding: "10px 12px",
        border: "1px solid var(--bd)",
        borderRadius: "12px",
        background: "var(--card)",
        color: "var(--tx)",
      }}
    >
      <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
        Preferências de contato desta loja
      </summary>
      <p style={{ margin: "8px 0", color: "var(--mut)", fontSize: "12px", lineHeight: 1.45 }}>
        Se quiser, receba lembretes sobre seu carrinho e novidades desta loja. Sua escolha não altera o pedido.
      </p>
      <fieldset disabled={loading || saving} style={{ margin: 0, padding: 0, border: 0, display: "grid", gap: "8px" }}>
        <label style={{ display: "flex", minHeight: "44px", alignItems: "center", gap: "9px", cursor: loading || saving ? "wait" : "pointer", fontSize: "13px" }}>
          <input type="checkbox" checked={selectedChannels.has("email")} onChange={() => toggleChannel("email")} />
          E-mail
        </label>
        <label style={{ display: "flex", minHeight: "44px", alignItems: "center", gap: "9px", cursor: loading || saving ? "wait" : "pointer", fontSize: "13px" }}>
          <input type="checkbox" checked={selectedChannels.has("whatsapp")} onChange={() => toggleChannel("whatsapp")} />
          WhatsApp
        </label>
      </fieldset>
      <button
        type="button"
        onClick={() => void persist()}
        disabled={loading || saving || !hasChanges}
        style={{
          minHeight: "44px",
          marginTop: "8px",
          padding: "8px 12px",
          border: 0,
          borderRadius: "9px",
          background: loading || saving || !hasChanges ? "var(--chip)" : "var(--aacp-accent, #0f766e)",
          color: loading || saving || !hasChanges ? "var(--mut)" : "#fff",
          cursor: loading || saving || !hasChanges ? "default" : "pointer",
          fontFamily: "inherit",
          fontSize: "12px",
          fontWeight: 700,
        }}
      >
        {saving ? "Atualizando..." : "Salvar preferência"}
      </button>
      {notice && <p role="status" style={{ margin: "8px 0 0", color: "var(--mut)", fontSize: "12px", lineHeight: 1.4 }}>{notice}</p>}
    </details>
  );
}
