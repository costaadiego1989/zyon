import React, { useState } from "react";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { TRIGGER_LABELS, TRIGGER_HELP, TRIGGER_STATUS } from "../lib/constants.js";
import { ToggleSwitch } from "./ToggleSwitch.js";

export function TriggerCard({
  trigger,
  enabled,
  busy,
  message,
  cooldownSeconds,
  couponCode,
  onChange,
  onMessageChange,
  onCooldownChange,
  onCouponChange,
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
  const status = TRIGGER_STATUS[trigger];
  const isSoon = status === "soon";
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`cfg-trigger${enabled && !isSoon ? " on" : ""}${isSoon ? " soon" : ""}`}>
      <div className="cfg-trigger-main" style={{ cursor: enabled && !isSoon ? "pointer" : "default" }} onClick={() => enabled && !isSoon && setExpanded(!expanded)}>
        <strong id={`trigger-${trigger}`}>
          {TRIGGER_LABELS[trigger]}
          {isSoon ? <span className="cfg-tag-soon">em breve</span> : null}
        </strong>
        <span>{TRIGGER_HELP[trigger]}</span>
      </div>
      <div className="cfg-trigger-controls">
        <ToggleSwitch
          id={`trigger-${trigger}`}
          checked={enabled}
          disabled={busy || isSoon}
          onChange={onChange}
        />
      </div>

      {enabled && !isSoon && expanded && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10, background: "var(--bg)" }}>
          <label style={{ display: "block" }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Mensagem do agente</span>
            <textarea
              value={message ?? ""}
              onChange={(e) => onMessageChange?.(e.target.value)}
              placeholder="Ex: Posso te ajudar com algo?"
              rows={2}
              maxLength={300}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--card)", resize: "vertical" }}
            />
            <span style={{ font: "10px var(--mono)", color: "var(--faint)" }}>{(message ?? "").length}/300</span>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "block" }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Tempo (segundos)</span>
              <input
                type="number"
                min={5}
                max={300}
                value={cooldownSeconds ?? 30}
                onChange={(e) => onCooldownChange?.(Math.max(5, Math.min(300, parseInt(e.target.value) || 30)))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
              />
              <span style={{ font: "10px var(--mono)", color: "var(--faint)" }}>Delay antes de disparar</span>
            </label>

            <label style={{ display: "block" }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Cupom (opcional)</span>
              <input
                type="text"
                value={couponCode ?? ""}
                onChange={(e) => onCouponChange?.(e.target.value.toUpperCase())}
                placeholder="PROMO10"
                maxLength={30}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)", textTransform: "uppercase" }}
              />
              <span style={{ font: "10px var(--mono)", color: "var(--faint)" }}>Cupom vinculado ao trigger</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
