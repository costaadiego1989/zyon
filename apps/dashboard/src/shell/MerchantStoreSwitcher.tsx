import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, Store } from "lucide-react";
import type { ManagedMerchantStore } from "../api/types.js";
import { useApi } from "../hooks/useApi.js";

export function MerchantStoreSwitcher({ currentStoreId, currentStoreName }: { currentStoreId: string; currentStoreName: string }) {
  const api = useApi();
  const [stores, setStores] = useState<ManagedMerchantStore[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([api.listMerchantStores(), api.getBillingSubscription()])
      .then(([available, subscription]) => {
        if (!active) return;
        setStores(available);
        setCanCreate(subscription.plan === "scale");
      })
      .catch(() => {
        if (!active) return;
        setStores([]);
        setCanCreate(false);
      });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (stores.length <= 1 && !canCreate) return null;

  async function activate(merchantId: string) {
    if (merchantId === currentStoreId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.activateMerchantStore(merchantId);
      window.location.reload();
    } catch {
      setError("Não foi possível trocar de loja. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const store = await api.createMerchantStore({ name, slug });
      setStores((current) => [...current, store]);
      await activate(store.id);
    } catch {
      setError("Não foi possível criar a loja. Verifique o nome e a URL.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="merchant-store-switcher" style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
        style={{ minHeight: 40, display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 9, border: "1px solid var(--color-border)", background: "var(--surface-2)", font: "12.5px var(--font-sans)", color: "var(--color-text-muted)", cursor: "pointer" }}
      >
        <Store size={14} />
        <span>{currentStoreName}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div ref={popoverRef} id={popoverId} role="dialog" aria-label="Trocar loja" aria-busy={busy} style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 30, minWidth: 280, padding: 8, borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--surface-2)", boxShadow: "0 18px 48px rgba(0,0,0,.24)" }}>
          <p style={{ margin: "6px 8px 8px", font: "600 10.5px var(--font-mono)", letterSpacing: ".06em", color: "var(--color-text-faint)" }}>SUAS LOJAS</p>
          {stores.map((store) => (
            <button
              type="button"
              key={store.id}
              disabled={busy || store.id === currentStoreId}
              onClick={() => void activate(store.id)}
              style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "9px 10px", border: 0, borderRadius: 8, background: store.id === currentStoreId ? "var(--color-brand-subtle)" : "transparent", color: "var(--color-text)", textAlign: "left", cursor: store.id === currentStoreId ? "default" : "pointer" }}
            >
              <span style={{ font: "500 13px var(--font-sans)" }}>{store.name}</span>
              <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>{store.slug ? `/${store.slug}` : "Configuração pendente"}</span>
            </button>
          ))}
          {canCreate && !creating && (
            <button type="button" onClick={() => setCreating(true)} disabled={busy} style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, marginTop: 6, padding: "9px 10px", border: "1px dashed var(--color-border)", borderRadius: 8, background: "transparent", color: "var(--color-brand)", font: "500 12.5px var(--font-sans)", cursor: "pointer" }}>
              <Plus size={14} /> Criar nova loja
            </button>
          )}
          {creating && (
            <form onSubmit={(event) => { event.preventDefault(); void create(); }} style={{ display: "grid", gap: 8, marginTop: 8, padding: 8, borderTop: "1px solid var(--color-border)" }}>
              <label style={{ display: "grid", gap: 4, font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                Nome da loja
                <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required autoFocus />
              </label>
              <label style={{ display: "grid", gap: 4, font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                URL da loja
                <input value={slug} onChange={(event) => setSlug(event.target.value)} minLength={3} maxLength={80} required placeholder="minha-nova-loja" />
              </label>
              <p style={{ margin: 0, font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>A nova loja começa sem catálogo, templates, integrações ou canais configurados.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" disabled={busy} style={{ flex: 1 }}>Criar e configurar</button>
                <button type="button" disabled={busy} onClick={() => setCreating(false)}>Cancelar</button>
              </div>
            </form>
          )}
          {error && <p role="alert" aria-live="polite" style={{ margin: "8px", color: "var(--color-error)", font: "12px var(--font-sans)" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
