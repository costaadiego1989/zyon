"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./QuickPurchasePreferencesDialog.module.css";

export type QuickPurchasePreferences = {
  shippingPreference: "fastest" | "cheapest";
  paymentPreference: "pix" | "card";
};

type Props = {
  open: boolean;
  initialValue?: QuickPurchasePreferences;
  onSave: (value: QuickPurchasePreferences) => Promise<void> | void;
  onCancel: () => void;
};

function Choice({
  checked,
  title,
  description,
  onSelect,
  testId,
  disabled,
}: {
  checked: boolean;
  title: string;
  description: string;
  onSelect: () => void;
  testId: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      data-quick-purchase-choice={testId}
      aria-pressed={checked}
      disabled={disabled}
      className={styles.choice}
      onClick={onSelect}
      style={{
        width: "100%",
        minHeight: "72px",
        padding: "12px 14px",
        borderRadius: "12px",
        border: `1px solid ${checked ? "var(--aacp-accent)" : "var(--aacp-line)"}`,
        background: checked ? "color-mix(in srgb, var(--aacp-accent) 12%, var(--aacp-card))" : "var(--aacp-card)",
        color: "var(--aacp-fg)",
        cursor: "pointer",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          border: `2px solid ${checked ? "var(--aacp-accent)" : "var(--aacp-muted)"}`,
          marginTop: "1px",
          display: "grid",
          placeItems: "center",
          flex: "none",
        }}
      >
        {checked && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--aacp-accent)" }} />}
      </span>
      <span style={{ display: "grid", gap: "3px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: "12px", lineHeight: 1.4, color: "var(--aacp-muted)" }}>{description}</span>
      </span>
    </button>
  );
}

export default function QuickPurchasePreferencesDialog({ open, initialValue, onSave, onCancel }: Props) {
  const dialog = useRef<HTMLElement>(null);
  const [shippingPreference, setShippingPreference] = useState<QuickPurchasePreferences["shippingPreference"]>(initialValue?.shippingPreference ?? "cheapest");
  const [paymentPreference, setPaymentPreference] = useState<QuickPurchasePreferences["paymentPreference"]>(initialValue?.paymentPreference ?? "pix");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setShippingPreference(initialValue?.shippingPreference ?? "cheapest");
    setPaymentPreference(initialValue?.paymentPreference ?? "pix");
    setSaving(false);
    setError(null);
  }, [initialValue?.paymentPreference, initialValue?.shippingPreference, open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']");
      if (!controls?.length) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open, saving]);

  if (!open) return null;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ shippingPreference, paymentPreference });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "N\u00e3o foi poss\u00edvel salvar suas prefer\u00eancias. Tente novamente.");
      setSaving(false);
    }
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) onCancel();
      }}
      className={styles.backdrop}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-purchase-preferences-title"
        aria-describedby="quick-purchase-preferences-description"
        aria-busy={saving}
        ref={dialog}
        tabIndex={-1}
        className={styles.dialog}
        data-quick-purchase-preferences-dialog
      >
        <div style={{ display: "grid", gap: "8px", marginBottom: "22px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--aacp-accent-text, var(--aacp-accent))" }}>Compra rápida</span>
          <h2 id="quick-purchase-preferences-title" style={{ margin: 0, fontSize: "22px", lineHeight: 1.2 }}>Defina como quer finalizar</h2>
          <p id="quick-purchase-preferences-description" style={{ margin: 0, color: "var(--aacp-muted)", fontSize: "13px", lineHeight: 1.5 }}>
            Escolha o frete e o pagamento da sua compra rápida. Você pode mudar essas preferências no Hub do Cliente.
          </p>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: "0 0 20px", display: "grid", gap: "9px" }}>
          <legend style={{ marginBottom: "9px", fontSize: "13px", fontWeight: 700 }}>Prioridade de frete</legend>
          <Choice disabled={saving} checked={shippingPreference === "cheapest"} testId="shipping-cheapest" title="Mais econômico" description="Entrega com o menor valor disponível." onSelect={() => setShippingPreference("cheapest")} />
          <Choice disabled={saving} checked={shippingPreference === "fastest"} testId="shipping-fastest" title="Mais rápido" description="Entrega com o menor prazo disponível." onSelect={() => setShippingPreference("fastest")} />
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: "0 0 22px", display: "grid", gap: "9px" }}>
          <legend style={{ marginBottom: "9px", fontSize: "13px", fontWeight: 700 }}>Pagamento preferido</legend>
          <Choice disabled={saving} checked={paymentPreference === "pix"} testId="payment-pix" title="Pix" description="Gera o código após aplicar frete e benefícios." onSelect={() => setPaymentPreference("pix")} />
          <Choice disabled={saving} checked={paymentPreference === "card"} testId="payment-card" title="Cartão" description="Pagamento no ambiente seguro do provedor." onSelect={() => setPaymentPreference("card")} />
        </fieldset>

        {error && <p role="alert" className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button data-neu="control" type="button" onClick={onCancel} disabled={saving}>Agora não</button>
          <button data-neu="primary" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Salvando..." : "Salvar e ativar"}
          </button>
        </div>
      </section>
    </div>
  );
}
