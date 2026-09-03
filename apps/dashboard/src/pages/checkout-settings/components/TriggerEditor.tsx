import React, { useState, useEffect, useRef } from "react";
import { X, Search } from "lucide-react";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { TRIGGER_LABELS, TRIGGER_HELP } from "../lib/constants.js";
import { Button } from "../../../components/Button.js";
import { useApi } from "../../../hooks/useApi.js";

interface TriggerDraft {
  message: string;
  cooldownSeconds: number;
  couponCode: string;
}

interface CouponOption {
  id: string;
  code: string;
  type: string;
  value: number;
  isActive: boolean;
}

function CouponSearchDropdown({ value, onChange, coupons, loaded }: {
  value: string;
  onChange: (v: string) => void;
  coupons: CouponOption[];
  loaded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = coupons.filter((c) =>
    (c.code ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const selected = coupons.find((c) => c.code === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          font: "13px var(--font-sans)",
          color: value ? "var(--color-text)" : "var(--color-text-faint)",
          background: "var(--surface-2)",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>
          {selected ? (
            <>
              <strong>{selected.code}</strong>
              <span style={{ color: "var(--color-text-muted)", marginLeft: 8, fontSize: 11 }}>
                {selected.type === "percent" ? `${selected.value}%` : `R$${(selected.value / 100).toFixed(2)}`}
              </span>
            </>
          ) : "Nenhum cupom selecionado"}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          background: "var(--surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
          zIndex: 200,
          maxHeight: 260,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Search */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--color-border)" }}>
            <Search size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cupom..."
              autoFocus
              style={{
                flex: 1,
                border: "none",
                font: "13px var(--font-sans)",
                color: "var(--color-text)",
                background: "transparent",
                outline: "none",
              }}
            />
          </div>

          {/* Options */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "none",
                background: !value ? "color-mix(in srgb, var(--color-brand) 8%, transparent)" : "transparent",
                font: "12px var(--font-sans)",
                color: "var(--color-text-muted)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Nenhum cupom
            </button>

            {!loaded && (
              <div style={{ padding: "10px 12px", font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>
                Carregando cupons...
              </div>
            )}

            {loaded && filtered.length === 0 && search && (
              <div style={{ padding: "10px 12px", font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>
                Nenhum cupom encontrado
              </div>
            )}

            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.code); setOpen(false); setSearch(""); }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "none",
                  background: value === c.code ? "color-mix(in srgb, var(--color-brand) 8%, transparent)" : "transparent",
                  font: "13px var(--font-mono)",
                  color: "var(--color-text)",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: value === c.code ? 600 : 400 }}>{c.code}</span>
                <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>
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

export function TriggerEditor({
  trigger,
  message,
  cooldownSeconds,
  couponCode,
  onSave,
  onCancel,
  busy,
}: {
  trigger: CheckoutTriggerName;
  message?: string;
  cooldownSeconds?: number;
  couponCode?: string;
  onSave: (data: { message: string; cooldownSeconds: number; couponCode: string }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const api = useApi();
  const [draft, setDraft] = useState<TriggerDraft>({
    message: message ?? "",
    cooldownSeconds: cooldownSeconds ?? 30,
    couponCode: couponCode ?? "",
  });
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [couponsLoaded, setCouponsLoaded] = useState(false);

  useEffect(() => {
    api.listCoupons?.().then((list) => {
      setCoupons((list as unknown as CouponOption[]).filter((c) => c.isActive && typeof c.code === "string"));
      setCouponsLoaded(true);
    }).catch(() => setCouponsLoaded(true));
  }, [api]);

  return (
    <div className="cfg-side-panel-overlay" onClick={onCancel}>
      <aside className="cfg-side-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cfg-side-panel-head">
          <div>
            <h3>Configurar sinal</h3>
            <p className="cfg-side-panel-subtitle">{TRIGGER_LABELS[trigger]} — {TRIGGER_HELP[trigger]}</p>
          </div>
          <button type="button" className="cfg-side-panel-close" onClick={onCancel} disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="cfg-side-panel-body">
          {/* Message */}
          <div className="cfg-field">
            <label htmlFor="trigger-msg">Mensagem do agente</label>
            <textarea
              id="trigger-msg"
              value={draft.message}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
              placeholder="Ex: Posso te ajudar com algo?"
              rows={3}
              maxLength={300}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                font: "13px var(--font-sans)",
                color: "var(--color-text)",
                background: "var(--surface-2)",
                outline: "none",
                resize: "vertical",
              }}
            />
            <span style={{ font: "10px var(--font-mono)", color: "var(--color-text-faint)", marginTop: 4, display: "block" }}>
              {draft.message.length}/300 — Texto que o agente envia ao disparar este sinal
            </span>
          </div>

          {/* Cooldown */}
          <div className="cfg-field">
            <label htmlFor="trigger-cooldown">Delay antes de disparar (segundos)</label>
            <input
              id="trigger-cooldown"
              type="number"
              min={5}
              max={300}
              value={draft.cooldownSeconds}
              onChange={(e) => setDraft({ ...draft, cooldownSeconds: Math.max(5, Math.min(300, parseInt(e.target.value) || 30)) })}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                font: "13px var(--font-mono)",
                color: "var(--color-text)",
                background: "var(--surface-2)",
                outline: "none",
              }}
            />
            <span style={{ font: "10px var(--font-mono)", color: "var(--color-text-faint)", marginTop: 4, display: "block" }}>
              Quanto tempo esperar antes de iniciar a ação
            </span>
          </div>

          {/* Coupon — searchable dropdown */}
          <div className="cfg-field">
            <label>Cupom vinculado (opcional)</label>
            <CouponSearchDropdown
              value={draft.couponCode}
              onChange={(v) => setDraft({ ...draft, couponCode: v })}
              coupons={coupons}
              loaded={couponsLoaded}
            />
            <span style={{ font: "10px var(--font-mono)", color: "var(--color-text-faint)", marginTop: 4, display: "block" }}>
              Se selecionado, o agente oferece este cupom ao disparar
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="cfg-side-panel-foot">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave(draft)}
            disabled={busy}
          >
            Salvar configuração
          </Button>
        </div>
      </aside>
    </div>
  );
}
