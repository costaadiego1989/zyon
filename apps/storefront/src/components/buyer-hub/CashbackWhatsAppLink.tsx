"use client";

import { useEffect, useRef, useState } from "react";
import { fetchBuyerWhatsAppLink, requestBuyerWhatsAppLinkCode, verifyBuyerWhatsAppLink, requestBuyerWhatsAppInboundLink,
  fetchBuyerWhatsAppInboundStatus, type BuyerWhatsAppLink, type BuyerWhatsAppInboundChallenge } from "../../lib/services/cashback.service";
import styles from "./CashbackWallet.module.css";

function maskedPhone(phone: string | null): string {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length > 4 ? `•• ••••• ${digits.slice(-4)}` : "número verificado";
}

export function CashbackWhatsAppLink({ merchantId, onLinked }: { merchantId?: string; onLinked?: () => void }) {
  const [link, setLink] = useState<BuyerWhatsAppLink | null>(null);
  const [phone, setPhone] = useState("");
  const [verificationPhone, setVerificationPhone] = useState<{ phone: string; merchantId: string } | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "preparing" | "sending" | "verifying" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [inbound, setInbound] = useState<(BuyerWhatsAppInboundChallenge & { merchantId: string }) | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const pending = useRef(false);
  const generation = useRef(0);
  const linkedCallback = useRef(onLinked); linkedCallback.current = onLinked;

  useEffect(() => {
    const controller = new AbortController();
    generation.current++; pending.current = false;
    setInbound(null); setVerificationPhone(null); setCode("");
    setStatus("loading"); setError(null);
    void fetchBuyerWhatsAppLink(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setLink(result); setStatus("ready");
    }).catch(() => { if (!controller.signal.aborted) { setStatus("error"); setError("Não foi possível consultar o vínculo com seu WhatsApp."); } });
    return () => { generation.current++; controller.abort(); };
  }, [attempt]);

  useEffect(() => {
    generation.current++; pending.current = false; setInbound(null); setError(null);
    setStatus(value => ["preparing", "sending", "verifying"].includes(value) ? "ready" : value);
    // An already-issued OTP keeps verificationPhone.merchantId. Only the new
    // inbound challenge and in-flight requests belong to the visible store.
    return () => { generation.current++; };
  }, [merchantId]);

  useEffect(() => {
    if (!inbound || inbound.merchantId !== merchantId) return;
    const current = generation.current;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (Date.now() >= new Date(inbound.expiresAt).getTime()) {
        setInbound(null); setError("A solicitação expirou. Inicie uma nova confirmação pelo WhatsApp."); return;
      }
      try {
        const result = await fetchBuyerWhatsAppInboundStatus(inbound.token, controller.signal);
        if (controller.signal.aborted || generation.current !== current) return;
        if (result.status === "confirmed" && result.linked) {
          setLink(result); setInbound(null); setPhone(""); setError(null); linkedCallback.current?.(); return;
        }
        if (result.status === "cancelled" || result.status === "expired") {
          setInbound(null); setError(result.status === "cancelled" ? "Você cancelou a solicitação no WhatsApp. O número não foi vinculado." : "A solicitação expirou. Inicie uma nova confirmação pelo WhatsApp."); return;
        }
        timer = setTimeout(poll, 2500);
      } catch { if (!controller.signal.aborted && generation.current === current) setError("Não foi possível consultar a confirmação. Use Verificar novamente para tentar outra vez."); }
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [inbound, pollAttempt, merchantId]);

  async function startInbound() {
    if (pending.current) return;
    if (!merchantId?.trim()) { setError("Abra sua conta dentro da loja para vincular o WhatsApp."); return; }
    const normalized = `+${phone.replace(/\D/g, "")}`;
    if (!/^\+55[1-9]\d{9,10}$/.test(normalized)) { setError("Informe seu WhatsApp com +55 e DDD, por exemplo +55 11 99999-9999."); return; }
    pending.current = true; const current = generation.current; setStatus("preparing"); setError(null);
    try {
      const result = await requestBuyerWhatsAppInboundLink(normalized, merchantId);
      if (generation.current !== current) return;
      const url = new URL(result.url);
      if (url.origin !== "https://wa.me" || !/^\/[1-9]\d{7,14}$/.test(url.pathname) || !Number.isFinite(new Date(result.expiresAt).getTime())) throw new Error("invalid_whatsapp_link");
      setInbound({ ...result, merchantId }); setStatus("ready");
    } catch { if (generation.current === current) { setError("Não foi possível preparar a confirmação pelo WhatsApp da loja. Aguarde um minuto e tente novamente."); setStatus("ready"); } }
    finally { if (generation.current === current) pending.current = false; }
  }

  async function sendCode() {
    if (pending.current) return;
    if (!merchantId?.trim()) { setError("Abra sua conta dentro da loja para vincular o WhatsApp."); return; }
    const normalized = `+${phone.replace(/\D/g, "")}`;
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) { setError("Informe o número com código do país e DDD, por exemplo +55 11 99999-9999."); return; }
    pending.current = true; const current = generation.current; setStatus("sending"); setError(null);
    try {
      const result = await requestBuyerWhatsAppLinkCode(normalized, merchantId);
      if (generation.current !== current) return;
      if (!result.sent) throw new Error("code_not_sent");
      setVerificationPhone({ phone: normalized, merchantId }); setCode(""); setStatus("ready");
    } catch { if (generation.current === current) { setError("Não foi possível enviar o código pelo WhatsApp da loja. Confira o número e tente mais tarde. Se continuar, fale com a loja."); setStatus("ready"); } }
    finally { if (generation.current === current) pending.current = false; }
  }

  async function verify() {
    if (pending.current || !verificationPhone) return;
    if (!/^\d{6}$/.test(code)) { setError("Digite o código de seis dígitos enviado ao seu WhatsApp."); return; }
    pending.current = true; const current = generation.current; setStatus("verifying"); setError(null);
    try {
      const result = await verifyBuyerWhatsAppLink(verificationPhone.phone, code, verificationPhone.merchantId);
      if (generation.current !== current) return;
      if (!result.linked) throw new Error("link_not_confirmed");
      setLink(result); setVerificationPhone(null); setCode(""); setPhone(""); setStatus("ready");
      onLinked?.();
    } catch { if (generation.current === current) { setError("Não foi possível confirmar o código. Confira os seis dígitos ou solicite um novo código."); setStatus("ready"); } }
    finally { if (generation.current === current) pending.current = false; }
  }

  const busy = status === "loading" || status === "preparing" || status === "sending" || status === "verifying";
  return <section className={styles.channel} aria-label="Mesma conta no WhatsApp" aria-busy={busy}>
    <h3>Mesma conta no site e WhatsApp</h3>
    <p>Vincule seu número para usar esta conta ao comprar pelo WhatsApp da loja. O cashback, quando disponível, também fica na mesma conta.</p>
    {status === "loading" ? <p role="status">Consultando vínculo do WhatsApp…</p> : link?.linked ? <p role="status"><strong>WhatsApp vinculado</strong> · {maskedPhone(link.phone)}</p> : status === "error" ? <button data-neu="secondary" className={styles.button} type="button" onClick={() => setAttempt(value => value + 1)}>Consultar novamente</button> : inbound ? <div className={styles.linkForm}>
      <p role="status">Abra o WhatsApp da loja, envie a mensagem preparada e toque em <strong>Confirmar vínculo</strong> na conversa. A solicitação vale por cinco minutos.</p>
      <a className={styles.button} href={inbound.url} target="_blank" rel="noopener noreferrer">Abrir WhatsApp da loja</a>
      <button data-neu="secondary" className={styles.button} type="button" onClick={() => { setError(null); setPollAttempt(value => value + 1); }}>Verificar novamente</button>
      <button data-neu="secondary" className={styles.button} type="button" onClick={() => { setInbound(null); setError(null); }}>Voltar</button>
    </div> : !verificationPhone ? <form className={styles.linkForm} onSubmit={event => { event.preventDefault(); void startInbound(); }}>
      <label>Número do WhatsApp<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+55 11 99999-9999" value={phone} disabled={busy} onChange={event => setPhone(event.target.value)} /></label>
      <button data-neu="primary" className={styles.button} type="submit" disabled={busy || !phone.trim()}>{status === "preparing" ? "Preparando confirmação…" : "Confirmar pelo WhatsApp"}</button>
      <button data-neu="secondary" className={styles.button} type="button" disabled={busy || !phone.trim()} onClick={() => void sendCode()}>{status === "sending" ? "Enviando código…" : "Enviar código"}</button>
    </form> : <form className={styles.linkForm} onSubmit={event => { event.preventDefault(); void verify(); }}>
      <p role="status">Código enviado ao WhatsApp {maskedPhone(verificationPhone.phone)}.</p>
      <label>Código de seis dígitos<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label>
      <button data-neu="primary" className={styles.button} type="submit" disabled={busy || code.length !== 6}>{status === "verifying" ? "Confirmando…" : "Confirmar WhatsApp"}</button>
      <button data-neu="secondary" className={styles.button} type="button" disabled={busy} onClick={() => { setVerificationPhone(null); setCode(""); setError(null); }}>Alterar número ou reenviar</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {!link?.linked && <p className={styles.notice}>O vínculo só é concluído após sua confirmação no WhatsApp ou a validação do código. Isso não autoriza mensagens promocionais.</p>}
  </section>;
}
