import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";
import { Button } from "../../../components/Button.js";
import type { ShippingWallet } from "../../../api/endpoints/delivery.js";
import "../delivery.css";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function MelhorEnvioWalletPanel({ onReconnect }: { onReconnect: () => void }) {
  const api = useApi();
  const id = useId();
  const [wallet, setWallet] = useState<ShippingWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState("100,00");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const initialized = useRef(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  const lastRequest = useRef(0);
  const generation = useRef(0);

  const load = useCallback(async (refresh = false) => {
    if (busy.current) return;
    const requestGeneration = generation.current;
    busy.current = true;
    lastRequest.current = Date.now();
    setLoading(true);
    try {
      const result = await api.getShippingWallet(refresh);
      if (!mounted.current || requestGeneration !== generation.current) return;
      setWallet(result); setLoadError(false); setAccessDenied(false);
      if (!initialized.current) {
        setEnabled(result.alert.enabled);
        setThreshold((result.alert.thresholdCents / 100).toFixed(2).replace(".", ","));
        setEmailEnabled(result.alert.emailEnabled);
        initialized.current = true;
      }
    } catch (error) { if (mounted.current && requestGeneration === generation.current) { setLoadError(true); setAccessDenied(!!error && typeof error === "object" && "status" in error && error.status === 403); } }
    finally { if (requestGeneration === generation.current) { busy.current = false; if (mounted.current) setLoading(false); } }
  }, [api]);

  useEffect(() => {
    generation.current++;
    mounted.current = true;
    initialized.current = false;
    setWallet(null);
    setSaving(false); setSaved(false); setFormError(null);
    setEnabled(false); setEmailEnabled(false); setThreshold("100,00");
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRequest.current >= 30_000) void load(true);
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false; generation.current++; busy.current = false; window.clearInterval(timer);
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const requestGeneration = generation.current;
    const raw = threshold.trim();
    if (!/^\d+(?:[,.]\d{1,2})?$/.test(raw)) { setFormError("Informe um valor entre R$ 0,01 e R$ 50.000,00, sem separador de milhar."); return; }
    const thresholdCents = Math.round(Number(raw.replace(",", ".")) * 100);
    if (!Number.isSafeInteger(thresholdCents) || thresholdCents < 1 || thresholdCents > 5_000_000) {
      setFormError("O limite deve ficar entre R$ 0,01 e R$ 50.000,00."); return;
    }
    busy.current = true;
    setSaving(true); setFormError(null); setSaved(false);
    try {
      const result = await api.updateShippingWalletAlert({ enabled, thresholdCents, emailEnabled: enabled && emailEnabled });
      if (!mounted.current || requestGeneration !== generation.current) return;
      setWallet(result); setLoadError(false); setSaved(true);
      setEnabled(result.alert.enabled); setEmailEnabled(result.alert.emailEnabled);
    } catch { if (mounted.current && requestGeneration === generation.current) setFormError("Não foi possível salvar o alerta. Seus ajustes foram mantidos. Tente novamente."); }
    finally { if (requestGeneration === generation.current) { busy.current = false; if (mounted.current) setSaving(false); } }
  }

  const unavailable = loadError || wallet?.status !== "ready";
  const reconnect = !loadError && (wallet?.errorCode === "reconnect_required" || wallet?.errorCode === "permission_denied");
  const rechargeUrl = wallet?.environment === "live" && wallet.rechargeUrl === "https://app.melhorenvio.com.br/melhor-carteira" ? wallet.rechargeUrl :
    wallet?.environment === "test" && wallet.rechargeUrl === "https://sandbox.melhorenvio.com.br/painel/melhor-carteira" ? wallet.rechargeUrl : null;

  if (accessDenied) return <section className="delivery-wallet"><h3>Saldo na carteira</h3><p>O saldo e os alertas podem ser consultados pelo proprietário ou por um administrador da loja.</p></section>;

  return <section className="delivery-wallet" aria-labelledby={`${id}-title`}>
    <div className="delivery-wallet__balance-row">
      <div><h3 id={`${id}-title`}>Saldo na carteira</h3>
        {loading && !wallet ? <span className="delivery-wallet__skeleton" role="status">Consultando saldo…</span> :
          <strong className="delivery-wallet__amount">{unavailable || wallet?.balanceCents === null ? "Saldo indisponível" : money(wallet!.balanceCents!)}</strong>}
      </div>
      <Button variant="ghost" size="sm" onClick={() => void load(true)} loading={loading} disabled={saving} aria-label="Atualizar saldo do Melhor Envio"><RefreshCw size={15} aria-hidden="true" />Atualizar saldo</Button>
    </div>
    {wallet?.environment === "test" && <p className="delivery-wallet__notice">Ambiente de testes. Estes créditos não podem ser usados em envios reais.</p>}
    {!unavailable && wallet?.checkedAt && <p>Atualizado em {new Date(wallet.checkedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} (Brasília).{wallet.stale ? " Atualize para conferir o saldo atual." : ""}</p>}
    {!unavailable && !!wallet?.reservedCents && <p>Valor reservado: {money(wallet.reservedCents)}.</p>}
    {!unavailable && !!wallet?.debtsCents && <p>Pendências na carteira: {money(wallet.debtsCents)}. Confira os detalhes no Melhor Envio.</p>}
    {(loadError || wallet?.status === "unavailable" || wallet?.status === "pending") && <p role="status">{reconnect
      ? "Reconecte sua conta para autorizar a consulta de saldo."
      : wallet?.status === "pending" ? "A consulta está em andamento. Atualize o saldo em instantes."
        : "Não foi possível consultar o saldo. Tente atualizar novamente."}</p>}
    {reconnect && <Button variant="outline" size="sm" onClick={onReconnect}>Reconectar conta</Button>}
    {wallet?.lowBalance && !unavailable && <p className="delivery-wallet__warning" role="status"><AlertCircle size={16} aria-hidden="true" /><span>Seu saldo está abaixo de {money(wallet.alert.thresholdCents)}. Adicione créditos para continuar comprando etiquetas.</span></p>}
    <p className="delivery-wallet__copy">Os créditos são o saldo da sua carteira no Melhor Envio, usado para pagar etiquetas de frete. O valor fica disponível após a aprovação do pagamento.</p>
    {rechargeUrl && <a className="zyn-btn zyn-btn--primary zyn-btn--md delivery-wallet__recharge" href={rechargeUrl} target="_blank" rel="noopener noreferrer"><span className="zyn-btn__label">Adicionar créditos<ExternalLink size={14} aria-hidden="true" /></span><span className="sr-only"> (abre em nova aba)</span></a>}
    {rechargeUrl && <p>Na carteira, escolha “Inserir saldo”. Use a mesma conta conectada à loja.</p>}
    <form className="delivery-wallet__alert" onSubmit={save} aria-labelledby={`${id}-alert`}>
      <h3 id={`${id}-alert`}>Alerta de saldo baixo</h3>
      <label className="delivery-wallet__check"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setSaved(false); }} disabled={!initialized.current || saving} />Avisar quando o saldo ficar baixo</label>
      {enabled && <>
        <label htmlFor={`${id}-threshold`}>Avise-me quando o saldo ficar abaixo de</label>
        <div className="delivery-wallet__threshold"><span aria-hidden="true">R$</span><input id={`${id}-threshold`} inputMode="decimal" type="text" value={threshold} onChange={e => { setThreshold(e.target.value); setSaved(false); }} disabled={saving} aria-invalid={!!formError} aria-describedby={`${id}-help${formError ? ` ${id}-error` : ""}`} /></div>
        <p id={`${id}-help`}>Verificação a cada 15 minutos, mesmo com o painel fechado. Um aviso por período de saldo baixo.</p>
        <label className="delivery-wallet__check"><input type="checkbox" checked={emailEnabled} onChange={e => { setEmailEnabled(e.target.checked); setSaved(false); }} disabled={saving || !wallet?.emailRecipient} />Receber também por e-mail</label>
        {emailEnabled && wallet?.emailRecipient && <p>Enviaremos para {wallet.emailRecipient}, e-mail do proprietário da loja.</p>}
        {!wallet?.emailRecipient && <p>O alerta por e-mail precisa de um proprietário ativo com e-mail cadastrado.</p>}
      </>}
      {wallet?.emailDeliveryFailed && <p role="status">Não foi possível enviar o último alerta por e-mail. O aviso continua disponível no sino de notificações.</p>}
      {formError && <p id={`${id}-error`} role="alert">{formError}</p>}
      {saved && <p role="status">Alerta salvo.</p>}
      <Button type="submit" variant="outline" size="sm" loading={saving} disabled={!initialized.current || loading}>Salvar alerta</Button>
    </form>
  </section>;
}
