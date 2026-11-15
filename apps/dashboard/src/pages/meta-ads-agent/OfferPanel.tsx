import { useRef, useState } from "react";
import type { MetaAdsOverview, MetaAdsSubscription } from "@zyon/shared-types";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { checkoutNavigate, date, money, useAction } from "./presentation.js";
export function OfferPanel({overview: data, api, onUpdated, navigate = checkoutNavigate}: {overview: MetaAdsOverview; api: MetaAdsAgentApi; onUpdated: () => void | Promise<void>; navigate?: (url: string) => void}) {
  const action = useAction(); const [cancelReview, setCancelReview] = useState(false); const [cancelled, setCancelled] = useState<MetaAdsSubscription | null>(null); const [pending, setPending] = useState(false);
  const keys = useRef<Record<string, string>>({}); const subscription = cancelled ?? data.subscription;
  const offer = data.entitled && subscription ? subscription.offer : data.offer;
  const checkout = (kind: "subscription" | "extra_images") => action.run(async () => {
    const key = `${kind}:${offer.version}`; keys.current[key] ??= crypto.randomUUID();
    const result = await api.checkout({kind, offerVersion: offer.version, idempotencyKey: keys.current[key]});
    // Checkout redirect is not payment confirmation. Only the webhook grants access.
    setPending(true); navigate(result.url);
  });
  return <section className="mga-panel" aria-labelledby="mga-offer-title">
    <div className="mga-section-heading"><h2 id="mga-offer-title">Seu adicional de anúncios</h2><span>{data.entitled ? "Ativo nesta loja" : "Contratação por loja"}</span></div>
    <p><strong>{money(offer.monthlyPriceCents)}/mês</strong>, além do plano Growth ou Escala. Inclui até {offer.monthlyImageCredits} imagens e {offer.maxManagedCampaigns} campanhas gerenciadas.</p>
    <p>Verba dos anúncios paga diretamente à Meta. Cada alteração exige sua aprovação.</p>
    {data.entitled && <dl className="mga-ledger"><div><dt>Imagens do mês disponíveis</dt><dd>{data.wallet.monthlyAvailable}</dd></div><div><dt>Extras disponíveis</dt><dd>{data.wallet.extraAvailable}</dd></div><div><dt>Em processamento ou conciliação</dt><dd>{data.wallet.reserved}</dd></div><div><dt>Fim da franquia atual</dt><dd>{date(data.wallet.periodEndsAt)}</dd></div></dl>}
    <p>A franquia mensal não acumula. Cada imagem utilizável consome um crédito; um carrossel de cinco imagens novas consome cinco. Extras comprados permanecem no saldo.</p>
    {!data.eligible && <p role="status">Disponível a partir do plano Growth. Altere seu plano para contratar.</p>}
    {!data.offer.commercialReady && <p role="status">Contratação temporariamente indisponível. O recurso está em validação.</p>}
    {pending && <p role="status">Confirmação do pagamento pendente. O saldo só muda após confirmação do provedor.</p>}
    {action.error && <p role="alert">{action.error}</p>}
    <div className="mga-actions">
      {!data.entitled ? <button type="button" disabled={action.busy || !data.eligible || !data.offer.commercialReady || subscription?.status === "checkout_pending"} onClick={() => void checkout("subscription")}>{action.busy ? "Abrindo pagamento…" : `Contratar por ${money(offer.monthlyPriceCents)}/mês`}</button> : <button type="button" disabled={action.busy || !data.offer.commercialReady} onClick={() => void checkout("extra_images")}>Comprar {offer.extraImageCredits} imagens por {money(offer.extraImagePriceCents)}</button>}
      {data.entitled && !subscription?.cancelAtPeriodEnd && <button type="button" className="mga-secondary" disabled={action.busy} onClick={() => setCancelReview(true)}>Cancelar renovação</button>}
    </div>
    {(cancelReview || subscription?.cancelAtPeriodEnd) && <div className="mga-notice"><p>O acesso termina em {date(subscription?.currentPeriodEnd ?? null)}. Campanhas na Meta podem continuar consumindo verba até você aprovar sua pausa ou pausá-las no Gerenciador de Anúncios.</p>
      {subscription?.cancelAtPeriodEnd ? <p role="status">Renovação cancelada. Você mantém acesso até o fim do período pago.</p> : <div className="mga-actions"><button type="button" disabled={action.busy} onClick={() => void action.run(async () => {setCancelled(await api.cancel()); setCancelReview(false); await onUpdated();})}>Confirmar cancelamento</button><button type="button" className="mga-secondary" disabled={action.busy} onClick={() => setCancelReview(false)}>Manter renovação</button></div>}
    </div>}
  </section>;
}
