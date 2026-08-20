import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
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
      setCoupons(list.filter((c: CouponOption) => c.isActive));
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
                border: "1px solid var(--border)",
                font: "13px var(--sans)",
                color: "var(--ink)",
                background: "var(--card)",
                outline: "none",
                resize: "vertical",
              }}
            />
            <span style={{ font: "10px var(--mono)", color: "var(--faint)", marginTop: 4, display: "block" }}>
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
                border: "1px solid var(--border)",
                font: "13px var(--mono)",
                color: "var(--ink)",
                background: "var(--card)",
                outline: "none",
              }}
            />
            <span style={{ font: "10px var(--mono)", color: "var(--faint)", marginTop: 4, display: "block" }}>
              Quanto tempo esperar antes de iniciar a ação
            </span>
          </div>

          {/* Coupon */}
          <div className="cfg-field">
            <label htmlFor="trigger-coupon">Cupom vinculado (opcional)</label>
            <select
              id="trigger-coupon"
              value={draft.couponCode}
              onChange={(e) => setDraft({ ...draft, couponCode: e.target.value })}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                font: "13px var(--sans)",
                color: "var(--ink)",
                background: "var(--card)",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="">Nenhum cupom</option>
              {!couponsLoaded && <option disabled>Carregando...</option>}
              {coupons.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} — {c.type === "percent" ? `${c.value}%` : `R$${(c.value / 100).toFixed(2)}`}
                </option>
              ))}
            </select>
            <span style={{ font: "10px var(--mono)", color: "var(--faint)", marginTop: 4, display: "block" }}>
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
