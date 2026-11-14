import { useEffect, useState } from "react";
import type { CheckoutSession } from "@/api/checkout-session";

type ContactChannel = "email" | "whatsapp";

const POLICY_VERSION = "checkout_campaign_contact_v1";
const channels: ContactChannel[] = ["email", "whatsapp"];

interface CampaignContactPreferencesProps {
  api: CheckoutSession | null;
  sessionId: string | null;
  merchantName: string;
}

export function CampaignContactPreferences({ api, sessionId, merchantName }: CampaignContactPreferencesProps) {
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
    void fetch(`${api.embedApiBaseUrl}/embed/checkout/consent/campaigns?session_id=${encodeURIComponent(sessionId)}`, {
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
      if (active) setNotice("Não foi possível carregar esta preferência agora.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [api, sessionId]);

  if (!api || !sessionId) return null;

  const toggleChannel = async (channel: ContactChannel) => {
    if (loading || saving) return;

    const next = new Set(selectedChannels);
    if (next.has(channel)) next.delete(channel);
    else next.add(channel);

    setSelectedChannels(next);
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`${api.embedApiBaseUrl}/embed/checkout/consent/campaigns`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.authToken}` },
        body: JSON.stringify({
          session_id: sessionId,
          policy_version: POLICY_VERSION,
          channels: channels.filter((candidate) => next.has(candidate)),
        }),
      });
      if (!response.ok) throw new Error("campaign_consent_save_failed");
      setSavedChannels(next);
      setNotice("Preferência atualizada.");
    } catch {
      setSelectedChannels(new Set(savedChannels));
      setNotice("Não foi possível atualizar agora.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Preferências de contato"
      style={{ flex: "none", marginTop: "12px", padding: "12px", borderTop: "1px solid var(--bd)" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
        <strong style={{ fontSize: "12px", color: "var(--tx)" }}>Novidades da {merchantName}</strong>
        <span style={{ fontSize: "11px", color: "var(--mut)" }}>Opcional</span>
      </div>
      <p style={{ margin: "4px 0 10px", color: "var(--mut)", fontSize: "11.5px", lineHeight: 1.45 }}>
        Autorize ofertas e lembretes da loja. Isso não altera o pedido nem seus comprovantes.
      </p>
      <div role="group" aria-label="Canais para novidades" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {channels.map((channel) => {
          const enabled = selectedChannels.has(channel);
          const label = channel === "email" ? "E-mail" : "WhatsApp";
          return (
            <button
              key={channel}
              type="button"
              aria-pressed={enabled}
              disabled={loading || saving}
              onClick={() => void toggleChannel(channel)}
              style={{
                minHeight: "36px",
                padding: "0 12px",
                borderRadius: "999px",
                border: "1px solid var(--bd)",
                background: enabled ? "color-mix(in srgb, var(--aacp-accent) 14%, var(--card))" : "var(--card)",
                color: enabled ? "var(--tx)" : "var(--mut)",
                fontFamily: "inherit",
                fontSize: "12px",
                fontWeight: 700,
                cursor: loading || saving ? "wait" : "pointer",
              }}
            >
              {enabled ? "✓ " : ""}{label}
            </button>
          );
        })}
      </div>
      {notice && <p role="status" style={{ margin: "8px 0 0", color: "var(--mut)", fontSize: "11px" }}>{notice}</p>}
    </section>
  );
}
