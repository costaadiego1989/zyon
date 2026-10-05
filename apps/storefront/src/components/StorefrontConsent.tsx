"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getValidBuyer, type ValidBuyer } from "@/lib/buyer-auth";
import { canSyncContactChoice, consentStorageKey, readStorefrontConsent, STOREFRONT_CONSENT_VERSION, writeStorefrontConsent, type ContactChannel, type StorefrontConsent } from "@/lib/storefront-consent";
import { GoogleTagManager } from "./GoogleTagManager";
import { FacebookPixel, TiktokPixel } from "./PixelTrackers";
import styles from "./StorefrontConsent.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";

export function StorefrontConsent({ storeKey, merchantId, storeName, gtmId, fbPixelId, tiktokPixelId, children }: {
  storeKey: string; merchantId?: string; storeName: string; gtmId?: string; fbPixelId?: string; tiktokPixelId?: string; children: ReactNode;
}) {
  const [choice, setChoice] = useState<StorefrontConsent | null>(null);
  const choiceRef = useRef<StorefrontConsent | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [optionalCookies, setOptionalCookies] = useState(false);
  const [channels, setChannels] = useState<ContactChannel[]>([]);
  const [buyer, setBuyer] = useState<ValidBuyer | null>(null);
  const buyerRef = useRef<ValidBuyer | null>(null);
  const [savedChannels, setSavedChannels] = useState<ContactChannel[]>([]);
  const savedChannelsBuyerRef = useRef<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasTrackers = Boolean(gtmId || fbPixelId || tiktokPixelId);

  useEffect(() => {
    const saved = readStorefrontConsent(storeKey);
    choiceRef.current = saved;
    setChoice(saved);
    setOptionalCookies(saved?.optionalCookies ?? false);
    setChannels([]);
    setSavedChannels([]);
    setOpen(!saved);
    setReady(true);
    document.documentElement.dataset.consentStore = storeKey;
    const refreshBuyer = () => {
      const current = getValidBuyer();
      buyerRef.current = current;
      setBuyer((previous) => previous?.token === current?.token ? previous : current);
    };
    const storageChanged = (event: StorageEvent) => {
      refreshBuyer();
      if (event.key !== consentStorageKey(storeKey)) return;
      const next = readStorefrontConsent(storeKey);
      if (choiceRef.current?.optionalCookies && !next?.optionalCookies) { window.location.reload(); return; }
      choiceRef.current = next;
      setChoice(next);
      if (next) setOpen(false);
    };
    refreshBuyer();
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", refreshBuyer);
    return () => {
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", refreshBuyer);
      delete document.documentElement.dataset.consentStore;
    };
  }, [storeKey]);

  useEffect(() => {
    if (!ready || !merchantId || !buyer) { setSavedChannels([]); setSyncing(false); return; }
    const controller = new AbortController();
    const token = buyer.token;
    const endpoint = `${API_BASE}/storefront/stores/${encodeURIComponent(merchantId)}/contact-consent`;
    setSavedChannels([]);
    savedChannelsBuyerRef.current = null;
    setSyncing(true);
    setNotice(null);
    void (async () => {
      try {
        let pending = choiceRef.current;
        if (pending && canSyncContactChoice(pending, buyer.globalUserId)) {
          // Bind before the first request: a change of account cannot inherit a guest's permission.
          pending = { ...pending, buyerId: buyer.globalUserId };
          choiceRef.current = pending;
          writeStorefrontConsent(storeKey, pending);
          const response = await fetch(endpoint, {
            method: "PUT", signal: controller.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ channels: pending.channels, policy_version: pending.version, decided_at: pending.decidedAt }),
          });
          if (!response.ok || (await response.json()).success !== true) throw Error("consent_save_failed");
          if (controller.signal.aborted || buyerRef.current?.token !== token || choiceRef.current?.decidedAt !== pending.decidedAt) return;
          const synced = { ...pending, pendingContactSync: false };
          choiceRef.current = synced;
          writeStorefrontConsent(storeKey, synced);
          setChoice(synced);
        }
        const response = await fetch(endpoint, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw Error("consent_load_failed");
        const payload = await response.json();
        if (payload.success !== true || !Array.isArray(payload.channels)) throw Error("consent_load_failed");
        if (!controller.signal.aborted && buyerRef.current?.token === token) {
          savedChannelsBuyerRef.current = buyer.globalUserId;
          setSavedChannels(payload.channels.filter((channel: unknown): channel is ContactChannel => channel === "email" || channel === "whatsapp"));
        }
      } catch {
        if (!controller.signal.aborted) setNotice("Não foi possível confirmar suas preferências de contato no servidor. Tente novamente.");
      } finally {
        if (!controller.signal.aborted) setSyncing(false);
      }
    })();
    return () => controller.abort();
  }, [ready, merchantId, buyer?.token, choice?.decidedAt, retry, storeKey]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, ready]);

  const edit = () => {
    const current = choiceRef.current;
    setOptionalCookies(current?.optionalCookies ?? false);
    setChannels(current && (!current.buyerId || current.buyerId === buyer?.globalUserId) && current.pendingContactSync
      ? current.channels : savedChannelsBuyerRef.current === buyer?.globalUserId ? savedChannels : []);
    setOpen(true);
  };

  const save = (accepted: boolean) => {
    const previous = choiceRef.current;
    const next: StorefrontConsent = {
      version: STOREFRONT_CONSENT_VERSION, optionalCookies: accepted && hasTrackers && optionalCookies,
      channels: accepted ? channels : [], decidedAt: new Date().toISOString(), buyerId: buyer?.globalUserId ?? null,
      pendingContactSync: true,
    };
    choiceRef.current = next;
    const persisted = writeStorefrontConsent(storeKey, next);
    setChoice(next);
    setOpen(false);
    setNotice(persisted ? null : "Seu navegador não permite salvar preferências. A escolha vale nesta visita.");
    if (previous?.optionalCookies && !next.optionalCookies) {
      // Reload stops third-party code that has already been executed; unmounting a Script does not.
      window.location.reload();
    }
  };

  return <>
    {ready && choice?.optionalCookies && <>
      <GoogleTagManager gtmId={gtmId} />
      <FacebookPixel pixelId={fbPixelId} />
      <TiktokPixel pixelId={tiktokPixelId} />
    </>}
    {children}
    <nav className={styles.footer} aria-label="Privacidade e consentimento">
      <button type="button" onClick={edit}>Cookies e contato</button>
      <a href="/politicas/privacidade" target="_blank" rel="noopener noreferrer">Privacidade</a>
      <a href="/politicas/termos" target="_blank" rel="noopener noreferrer">Termos</a>
    </nav>
    {notice && <div className={styles.notice} role="status">{notice} <button type="button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div>}
    {ready && <dialog ref={dialogRef} className={styles.dialog} data-neu="overlay" aria-labelledby="storefront-consent-title"
      onCancel={(event) => event.preventDefault()}>
      <div className={styles.handle} aria-hidden="true"><span /></div>
      <div className={styles.heading}>
        <h2 id="storefront-consent-title">Sua privacidade nesta loja</h2>
      </div>
      <div className={styles.body}>
        <p>Escolha o que autoriza em <strong>{storeName}</strong>. Recusar as opções abaixo não impede sua compra.</p>
        <section className={styles.essential} aria-label="Armazenamento necessário">
          <h3>Sessão e carrinho <span>Sempre necessários</span></h3>
          <p>Usamos cookies e armazenamento do navegador para acesso, segurança, carrinho e para lembrar esta escolha.</p>
        </section>
        {hasTrackers && <label className={styles.option}>
          <input type="checkbox" checked={optionalCookies} onChange={(event) => setOptionalCookies(event.target.checked)} />
          <span><strong>Cookies de medição e publicidade</strong><small>Permitir os serviços configurados pela loja: {[gtmId && "Google Tag Manager", fbPixelId && "Meta Pixel", tiktokPixelId && "TikTok Pixel"].filter(Boolean).join(", ")}.</small></span>
        </label>}
        <fieldset className={styles.channels} disabled={syncing && Boolean(buyer)}>
          <legend>Ofertas, novidades e lembretes de carrinho</legend>
          <p>Autorize separadamente cada canal. Avisos necessários de compra, pagamento e entrega seguem o fluxo do pedido, sem conteúdo promocional.</p>
          <div className={styles.channelOptions}>
            {(["whatsapp", "email"] as const).map((channel) => <label className={styles.option} key={channel}>
              <input type="checkbox" checked={channels.includes(channel)} onChange={(event) => setChannels((current) => event.target.checked ? [...current, channel] : current.filter((value) => value !== channel))} />
              <span>{channel === "email" ? "E-mail" : "WhatsApp"}</span>
            </label>)}
          </div>
        </fieldset>
        <p className={styles.storage}>A escolha fica neste navegador. Ao entrar na conta, as permissões de contato são registradas no servidor por loja e canal. Você pode alterá-las em “Cookies e contato”.</p>
        <div className={styles.links}><a href="/politicas/cookies" target="_blank" rel="noopener noreferrer">Política de cookies</a><a href="/politicas/privacidade" target="_blank" rel="noopener noreferrer">Como usamos seus dados</a></div>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => save(false)}>Não aceito</button>
        <button type="button" onClick={() => save(true)} disabled={syncing && Boolean(buyer)}>Aceitar seleção</button>
      </div>
    </dialog>}
  </>;
}
