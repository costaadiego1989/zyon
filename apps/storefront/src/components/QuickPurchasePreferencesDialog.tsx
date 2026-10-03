"use client";

import { useEffect, useState } from "react";

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
}: {
  checked: boolean;
  title: string;
  description: string;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-quick-purchase-choice={testId}
      aria-pressed={checked}
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
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
      style={{ position: "fixed", inset: 0, zIndex: 10001, padding: "20px", display: "grid", placeItems: "center", background: "rgba(5, 12, 8, 0.64)" }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-purchase-preferences-title"
        data-quick-purchase-preferences-dialog
        style={{
          width: "min(100%, 520px)",
          maxHeight: "min(88vh, 720px)",
          overflowY: "auto",
          padding: "24px",
          borderRadius: "18px",
          border: "1px solid var(--aacp-line)",
          background: "var(--aacp-panel-bg)",
          color: "var(--aacp-fg)",
          boxShadow: "0 24px 56px rgba(0, 0, 0, .35)",
        }}
      >
        <div style={{ display: "grid", gap: "8px", marginBottom: "22px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--aacp-accent-text, var(--aacp-accent))" }}>Compra r\u00e1pida</span>
          <h2 id="quick-purchase-preferences-title" style={{ margin: 0, fontSize: "22px", lineHeight: 1.2 }}>Defina como quer finalizar</h2>
          <p style={{ margin: 0, color: "var(--aacp-muted)", fontSize: "13px", lineHeight: 1.5 }}>
            Usaremos estas escolhas somente quando voc\u00ea iniciar uma compra r\u00e1pida. Voc\u00ea pode alter\u00e1-las no Hub do Cliente antes da pr\u00f3xima compra.
          </p>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: "0 0 20px", display: "grid", gap: "9px" }}>
          <legend style={{ marginBottom: "9px", fontSize: "13px", fontWeight: 700 }}>Prioridade de frete</legend>
          <Choice checked={shippingPreference === "cheapest"} testId="shipping-cheapest" title="Mais econ\u00f4mico" description="Seleciona a op\u00e7\u00e3o de entrega com menor valor dispon\u00edvel." onSelect={() => setShippingPreference("cheapest")} />
          <Choice checked={shippingPreference === "fastest"} testId="shipping-fastest" title="Mais r\u00e1pido" description="Seleciona a op\u00e7\u00e3o de entrega com menor prazo dispon\u00edvel." onSelect={() => setShippingPreference("fastest")} />
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: "0 0 22px", display: "grid", gap: "9px" }}>
          <legend style={{ marginBottom: "9px", fontSize: "13px", fontWeight: 700 }}>Pagamento preferido</legend>
          <Choice checked={paymentPreference === "pix"} testId="payment-pix" title="Pix" description="Gera o Pix do pedido ap\u00f3s aplicar o frete escolhido." onSelect={() => setPaymentPreference("pix")} />
          <Choice checked={paymentPreference === "card"} testId="payment-card" title="Cart\u00e3o" description="Abre o ambiente seguro do provedor para informar o cart\u00e3o." onSelect={() => setPaymentPreference("card")} />
        </fieldset>

        {error && <p role="alert" style={{ margin: "0 0 14px", color: "#f87171", fontSize: "13px" }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={onCancel} disabled={saving} style={{ minHeight: "44px", padding: "10px 14px", border: "1px solid var(--aacp-line)", borderRadius: "10px", background: "transparent", color: "var(--aacp-fg)", fontFamily: "inherit", cursor: saving ? "wait" : "pointer" }}>Agora n\u00e3o</button>
          <button type="button" autoFocus onClick={() => void save()} disabled={saving} style={{ minHeight: "44px", padding: "10px 16px", border: 0, borderRadius: "10px", background: "var(--aacp-accent)", color: "var(--aacp-on-accent, #fff)", fontWeight: 700, fontFamily: "inherit", cursor: saving ? "wait" : "pointer", opacity: saving ? .72 : 1 }}>
            {saving ? "Salvando..." : "Salvar e ativar"}
          </button>
        </div>
      </section>
    </div>
  );
}
