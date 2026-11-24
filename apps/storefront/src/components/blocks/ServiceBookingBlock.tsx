"use client";

import { useEffect, useState } from "react";
import { ServiceBookingPicker, ServiceBookingUncertainError, type ServiceBookingReadAccess, type ServiceBookingAccess } from "@zyon/widget-v2";
import { CheckoutSession } from "../../../../widget_v2/src/api/checkout-session";
import { getValidBuyer } from "../../lib/buyer-auth";
import { requestStorefrontCheckoutToken } from "../../lib/checkout-session-access";

export type StorefrontServiceBookingBinding = {
  merchantId: string;
  cartRef: string;
  onAuthenticate: (onCancel?: () => void) => void;
  onCheckout: (input: { embedToken: string; globalUserId: string; cartRef: string }) => void;
};
/** Read-only availability and private writer continuity share the real issuer,
 * while buyer changes never unmount or authorize the public local selection. */
export default function ServiceBookingBlock({ data, binding, onRefresh }: { data: unknown; binding?: StorefrontServiceBookingBinding; onRefresh?: () => void }) {
  const [buyer, setBuyer] = useState(getValidBuyer);
  const merchantId = binding?.merchantId, cartRef = binding?.cartRef;
  const publicKey = JSON.stringify([merchantId, cartRef]);
  const key = JSON.stringify([publicKey, buyer?.globalUserId, buyer?.token]);
  const [readCredential, setReadCredential] = useState<{ key: string; access: ServiceBookingReadAccess } | null>(null);
  const [credential, setCredential] = useState<{ key: string; access: ServiceBookingAccess } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [readFailure, setReadFailure] = useState<string | null>(null);
  const [revision, setRevision] = useState(0), [readRevision, setReadRevision] = useState(0);
  useEffect(() => {
    const changed = () => setBuyer(getValidBuyer());
    window.addEventListener("storage", changed); window.addEventListener("focus", changed);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", changed); };
  }, []);
  useEffect(() => {
    let active = true; setReadFailure(null);
    if (!merchantId || !cartRef) { setReadCredential(null); return; }
    // No fake buyer or fresh-cart fallback: checkout:start is already issued to
    // this real anonymous conversation; only public GETs use this credential.
    void requestStorefrontCheckoutToken({ merchantId, cartRef }).then(embedToken => {
      if (active) setReadCredential({ key: publicKey, access: { merchantId, embedToken,
        apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009", embedApiBaseUrl: "/api" } });
    }).catch(() => { if (active) { setReadCredential(null); setReadFailure(publicKey); } });
    return () => { active = false; };
  }, [publicKey, readRevision]);
  useEffect(() => {
    let active = true; setFailure(null);
    if (!merchantId || !cartRef || !buyer) { setCredential(null); return; }
    // This calls the SAME issuer with the prior token and real buyer JWT. The
    // server alone decides the scope upgrade and preserves cart/nonce/history.
    void requestStorefrontCheckoutToken({ merchantId, cartRef }).then(embedToken => {
      if (active) setCredential({ key, access: { merchantId, embedToken, buyerAccessToken: buyer.token, globalUserId: buyer.globalUserId,
        apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009", embedApiBaseUrl: "/api" } });
    }).catch(() => { if (active) { setCredential(null); setFailure(key); } });
    return () => { active = false; };
  }, [key, revision]);
  const currentBuyer = getValidBuyer();
  const readAccess = readCredential?.key === publicKey ? readCredential.access : null;
  const access = credential?.key === key && currentBuyer?.token === buyer?.token
    && currentBuyer?.globalUserId === buyer?.globalUserId ? credential.access : null;
  return <>
    {readFailure === publicKey && <div role="alert"><p>Não foi possível consultar a disponibilidade agora.</p><button type="button" onClick={() => setReadRevision(value => value + 1)}>Consultar disponibilidade novamente</button></div>}
    {failure === key && <div role="alert"><p>Não foi possível recuperar a autorização para continuar. Seu pedido e eventual pagamento serão preservados.</p><button type="button" onClick={() => setRevision(value => value + 1)}>Verificar acesso novamente</button></div>}
    <ServiceBookingPicker data={data} access={access} readAccess={readAccess} cartRef={cartRef} buyerIdentity={currentBuyer?.globalUserId ?? null}
      authenticationPending={!!buyer && !access && failure !== key}
      authenticationFailed={failure === key}
      onAuthenticate={binding ? onCancel => { if (getValidBuyer()) setRevision(value => value + 1); else binding.onAuthenticate(onCancel); } : undefined} onRefreshContext={onRefresh}
      onReviewCheckout={access ? async () => { const session = new CheckoutSession({ ...access, cartRef }); try { await session.start(); } catch { throw new ServiceBookingUncertainError(); } } : undefined}
      onCheckout={access && binding && cartRef ? () => binding.onCheckout({ embedToken: access.embedToken, globalUserId: access.globalUserId, cartRef }) : undefined} />
  </>;
}
