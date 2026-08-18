import React, { useEffect, useState } from "react";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { TRIGGER_LABELS, TRIGGER_HELP, TRIGGER_STATUS } from "../lib/constants.js";
import { ToggleSwitch } from "./ToggleSwitch.js";
import { useApi } from "../../../hooks/useApi.js";

interface CouponOption {
  id: string;
  code: string;
  type: string;
  value: number;
  isActive: boolean;
}

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
        <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 16, background: "var(--bg)" }}>
          <div>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Mensagem do agente</span>
            <textarea
              value={message ?? ""}
              onChange={(e) => onMessageChange?.(e.target.value)}
              placeholder="Ex: Posso te ajudar com algo?"
              rows={2}
              maxLength={300}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--card)", resize: "vertical" }}
            />
            <span style={{ font: "10px var(--mono)", color: "var(--faint)", marginTop: 4, display: "block" }}>{(message ?? "").length}/300</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Tempo (segundos)</span>
              <input
                type="number"
                min={5}
                max={300}
                value={cooldownSeconds ?? 30}
                onChange={(e) => onCooldownChange?.(Math.max(5, Math.min(300, parseInt(e.target.value) || 30)))}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
              />
              <span style={{ font: "10px var(--mono)", color: "var(--faint)", marginTop: 4, display: "block" }}>Delay antes de disparar</span>
            </div>

            <CouponDropdown
              value={couponCode ?? ""}
              onChange={(v) => onCouponChange?.(v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CouponDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const api = useApi();
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    api.listCoupons?.().then((list) => {
      setCoupons(list.filter((c) => c.isActive));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [open, loaded, api]);

  const filtered = coupons.filter((c) =>
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  const selectedLabel = value || "Nenhum";

  return (
    <div style={{ position: "relative" }}>
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Cupom (opcional)</span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          font: "12px var(--mono)",
          color: value ? "var(--ink)" : "var(--faint)",
          background: "var(--card)",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{selectedLabel}</span>
        <span style={{ fontSize: 10, color: "var(--faint)" }}>▾</span>
      </button>
      <span style={{ font: "10px var(--mono)", color: "var(--faint)", marginTop: 4, display: "block" }}>Cupom vinculado ao trigger</span>

      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: 4,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          zIndex: 100,
          maxHeight: 200,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cupom..."
            autoFocus
            style={{
              padding: "8px 10px",
              border: "none",
              borderBottom: "1px solid var(--border)",
              font: "12px var(--sans)",
              color: "var(--ink)",
              background: "transparent",
              outline: "none",
            }}
          />
          <div style={{ overflowY: "auto", flex: 1 }}>
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "none",
                background: !value ? "var(--accent-soft)" : "transparent",
                font: "12px var(--sans)",
                color: "var(--muted)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Nenhum
            </button>
            {!loaded && <div style={{ padding: "8px 10px", font: "11px var(--sans)", color: "var(--faint)" }}>Carregando...</div>}
            {loaded && filtered.length === 0 && search && (
              <div style={{ padding: "8px 10px", font: "11px var(--sans)", color: "var(--faint)" }}>Nenhum cupom encontrado</div>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.code); setOpen(false); setSearch(""); }}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  background: value === c.code ? "var(--accent-soft)" : "transparent",
                  font: "12px var(--mono)",
                  color: "var(--ink)",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{c.code}</span>
                <span style={{ font: "10px var(--sans)", color: "var(--faint)" }}>
                  {c.type === "percent" ? `${c.value}%` : `R$${(c.value / 100).toFixed(2)}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
