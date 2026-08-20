import React from "react";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { TRIGGER_LABELS, TRIGGER_HELP } from "../lib/constants.js";
import { ToggleSwitch } from "./ToggleSwitch.js";
import { Zap, Clock, CreditCard } from "lucide-react";

const TRIGGER_ICONS: Record<CheckoutTriggerName, React.ReactNode> = {
  exit_intent_detected: <Zap size={18} strokeWidth={1.6} />,
  idle_30_seconds: <Clock size={18} strokeWidth={1.6} />,
  payment_failed: <CreditCard size={18} strokeWidth={1.6} />,
  shipping_objection_detected: <Zap size={18} strokeWidth={1.6} />,
  coupon_field_clicked: <Zap size={18} strokeWidth={1.6} />,
};

export function TriggerCard({
  trigger,
  enabled,
  busy,
  onChange,
}: {
  trigger: CheckoutTriggerName;
  enabled: boolean;
  busy: boolean;
  message?: string;
  cooldownSeconds?: number;
  couponCode?: string;
  onChange: (v: boolean) => void;
  onMessageChange?: (v: string) => void;
  onCooldownChange?: (v: number) => void;
  onCouponChange?: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 18px",
        borderRadius: 12,
        border: `1px solid ${enabled ? "color-mix(in srgb, var(--accent) 30%, var(--border))" : "var(--border)"}`,
        background: enabled ? "color-mix(in srgb, var(--accent) 4%, var(--card))" : "var(--card)",
        transition: "all 0.15s ease",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: enabled ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--bg)",
          color: enabled ? "var(--accent)" : "var(--muted)",
          flexShrink: 0,
          transition: "all 0.15s ease",
        }}
      >
        {TRIGGER_ICONS[trigger]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "600 13px var(--sans)", color: "var(--ink)", lineHeight: 1.3 }}>
          {TRIGGER_LABELS[trigger]}
        </div>
        <div style={{ font: "11.5px var(--sans)", color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>
          {TRIGGER_HELP[trigger]}
        </div>
      </div>
      <ToggleSwitch
        id={`trigger-${trigger}`}
        checked={enabled}
        disabled={busy}
        onChange={onChange}
      />
    </div>
  );
}
