import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Plus, Store } from "lucide-react";
import type { ManagedMerchantStore } from "../api/types.js";
import { useApi } from "../hooks/useApi.js";
import { Button } from "../components/Button.js";
import { Modal } from "../components/Modal.js";
import { FormField } from "../components/FormField.js";
import { SegmentSelect } from "../components/SegmentSelect.js";
import { STORE_CATEGORIES } from "../lib/signup-options.js";
import { maskCNPJ, maskPhone, validateCNPJ } from "../utils/masks.js";
import "../components/configuration-form.css";

type StoreDraft = {
  name: string;
  cnpj: string;
  email: string;
  phone: string;
  storeCategory: string;
};

const EMPTY_STORE_DRAFT: StoreDraft = { name: "", cnpj: "", email: "", phone: "", storeCategory: "" };

export function MerchantStoreSwitcher({ currentStoreId, currentStoreName }: { currentStoreId: string; currentStoreName: string }) {
  const api = useApi();
  const [stores, setStores] = useState<ManagedMerchantStore[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<StoreDraft>(EMPTY_STORE_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof StoreDraft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([api.listMerchantStores(), api.getBillingSubscription().catch(() => null)])
      .then(([available, subscription]) => {
        if (!active) return;
        setStores(available);
        setCanCreate(subscription?.plan === "scale");
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
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (stores.length <= 1 && !canCreate) return null;

  async function activate(merchantId: string, destination?: "onboarding"): Promise<boolean> {
    if (merchantId === currentStoreId) {
      setOpen(false);
      return true;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await api.activateMerchantStore(merchantId);
      if (session.merchant_id !== merchantId) throw new Error("merchant_store_activation_mismatch");

      const nextLocation = new URL(window.location.href);
      nextLocation.hash = destination ?? "";
      window.history.replaceState(null, "", nextLocation.toString());
      window.location.reload();
      return true;
    } catch {
      setError("Não foi possível trocar de loja. Tente novamente.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const nextErrors = validateStoreDraft(draft);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    setError(null);
    let createdStore: ManagedMerchantStore | undefined;
    try {
      const store = await api.createMerchantStore({
        name: draft.name,
        cnpj: draft.cnpj,
        email: draft.email,
        phone: draft.phone,
        storeCategory: draft.storeCategory,
      });
      createdStore = store;
      setStores((previous) => previous.some((current) => current.id === store.id) ? previous : [...previous, store]);
      if (!(await activate(store.id, "onboarding"))) {
        setError("A loja foi criada, mas não foi possível abri-la. Atualize a página e selecione-a na lista.");
      }
    } catch {
      setError(createdStore
        ? "A loja foi criada, mas não foi possível abri-la. Atualize a página e selecione-a na lista."
        : "Não foi possível criar a loja. Revise os dados e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  function openCreateModal() {
    const parentStore = stores.find((store) => store.isBillingAccount);
    setError(null);
    setFieldErrors({});
    setDraft({ ...EMPTY_STORE_DRAFT, storeCategory: parentStore?.storeCategory ?? "" });
    setOpen(false);
    setCreating(true);
  }

  function closeCreateModal() {
    if (busy) return;
    setCreating(false);
    setDraft(EMPTY_STORE_DRAFT);
    setFieldErrors({});
    setError(null);
  }

  const parentStore = stores.find((store) => store.isBillingAccount);

  return (
    <>
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
              <button key={store.id} type="button" disabled={busy || store.id === currentStoreId} onClick={() => void activate(store.id)} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "9px 10px", border: 0, borderRadius: 8, background: store.id === currentStoreId ? "var(--color-brand-subtle)" : "transparent", color: "var(--color-text)", textAlign: "left", cursor: store.id === currentStoreId ? "default" : "pointer" }}>
                <span style={{ font: "500 13px var(--font-sans)" }}>{store.name}</span>
                <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>{store.slug ? `/${store.slug}` : "Configuração pendente"}</span>
              </button>
            ))}
            {canCreate && <button type="button" onClick={openCreateModal} disabled={busy} style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, marginTop: 6, padding: "9px 10px", border: "1px dashed var(--color-border)", borderRadius: 8, background: "transparent", color: "var(--color-brand)", font: "500 12.5px var(--font-sans)", cursor: "pointer" }}><Plus size={14} /> Criar nova loja</button>}
            {error && <p role="alert" aria-live="polite" style={{ margin: "8px", color: "var(--color-error)", font: "12px var(--font-sans)" }}>{error}</p>}
          </div>
        )}
      </div>
      <Modal
        isOpen={creating}
        title="Criar nova loja"
        eyebrow="PLANO ESCALA"
        subtitle="Cadastre os dados da nova operação agora. O endereço será criado automaticamente a partir do nome."
        presentation="center"
        size="md"
        onClose={closeCreateModal}
        footer={<><Button variant="outline" disabled={busy} onClick={closeCreateModal}>Cancelar</Button><Button type="submit" form="create-merchant-store" loading={busy} disabled={busy}>Criar e abrir primeiros passos</Button></>}
      >
        <form id="create-merchant-store" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <fieldset className="configuration-form" disabled={busy}>
            <section className="configuration-form__section">
              <h3>Dados da nova loja</h3>
              <p>Esses dados ficam nesta loja e já estarão disponíveis nas configurações e nos próximos passos.</p>
              <FormField label="Nome da loja" value={draft.name} onChange={(name) => setDraft((current) => ({ ...current, name }))} placeholder="Ex.: Loja Aurora" autoFocus maxLength={80} error={fieldErrors.name} inputProps={{ autoComplete: "organization" }} />
              <div className="configuration-form__grid">
                <FormField label="CNPJ" value={draft.cnpj} onChange={(cnpj) => setDraft((current) => ({ ...current, cnpj: maskCNPJ(cnpj) }))} placeholder="00.000.000/0000-00" maxLength={18} error={fieldErrors.cnpj} inputProps={{ inputMode: "numeric", autoComplete: "off" }} />
                <FormField label="Celular" type="tel" value={draft.phone} onChange={(phone) => setDraft((current) => ({ ...current, phone: maskPhone(phone) }))} placeholder="(11) 99999-9999" maxLength={15} error={fieldErrors.phone} inputProps={{ autoComplete: "tel-national" }} />
              </div>
              <FormField label="E-mail comercial" type="email" value={draft.email} onChange={(email) => setDraft((current) => ({ ...current, email }))} placeholder="contato@sualoja.com.br" maxLength={254} error={fieldErrors.email} inputProps={{ autoComplete: "email" }} />
              <div className="form-field">
                <label>Tipo da loja</label>
                <SegmentSelect value={draft.storeCategory} onChange={(storeCategory) => setDraft((current) => ({ ...current, storeCategory }))} options={STORE_CATEGORIES} placeholder="Selecione o tipo" ariaLabel="Tipo da loja" hasError={Boolean(fieldErrors.storeCategory)} />
                <span className={fieldErrors.storeCategory ? "form-field-error" : "form-field-hint"} role={fieldErrors.storeCategory ? "alert" : undefined}>
                  {fieldErrors.storeCategory ?? (parentStore?.storeCategory ? "Pré-selecionado com o tipo da conta principal. Você pode alterar." : "Escolha o segmento que orientará a IA desta loja.")}
                </span>
              </div>
            </section>
            <p className="configuration-form__note">Catálogo, pagamentos, WhatsApp, integrações e canais continuam isolados. Você os configura nos próximos passos da nova loja.</p>
            {error && <p className="form-field-error" role="alert" aria-live="polite">{error}</p>}
          </fieldset>
        </form>
      </Modal>
    </>
  );
}

function validateStoreDraft(draft: StoreDraft): Partial<Record<keyof StoreDraft, string>> {
  const errors: Partial<Record<keyof StoreDraft, string>> = {};
  if (draft.name.trim().length < 2) errors.name = "Informe o nome da loja.";
  if (!validateCNPJ(draft.cnpj)) errors.cnpj = "Informe um CNPJ válido.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = "Informe um e-mail comercial válido.";
  if (draft.phone.replace(/\D/g, "").length < 10) errors.phone = "Informe um celular válido.";
  if (!draft.storeCategory) errors.storeCategory = "Selecione o tipo da loja.";
  return errors;
}
