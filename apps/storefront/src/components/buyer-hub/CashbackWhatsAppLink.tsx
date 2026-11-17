"use client";

import { useEffect, useRef, useState } from "react";
import { fetchBuyerWhatsAppLink, requestBuyerWhatsAppLinkCode, verifyBuyerWhatsAppLink, type BuyerWhatsAppLink } from "../../lib/services/cashback.service";
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
  const [status, setStatus] = useState<"loading" | "ready" | "sending" | "verifying" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading"); setError(null);
    void fetchBuyerWhatsAppLink(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setLink(result); setStatus("ready");
    }).catch(() => { if (!controller.signal.aborted) { setStatus("error"); setError("Não foi possível consultar o vínculo com seu WhatsApp."); } });
    return () => controller.abort();
  }, [attempt]);

  async function sendCode() {
    if (pending.current) return;
    if (!merchantId?.trim()) { setError("Abra sua conta dentro da loja para vincular o WhatsApp."); return; }
    const normalized = `+${phone.replace(/\D/g, "")}`;
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) { setError("Informe o número com código do país e DDD, por exemplo +55 11 99999-9999."); return; }
    pending.current = true; setStatus("sending"); setError(null);
    try {
      const result = await requestBuyerWhatsAppLinkCode(normalized, merchantId);
      if (!result.sent) throw new Error("code_not_sent");
      setVerificationPhone({ phone: normalized, merchantId }); setCode(""); setStatus("ready");
    } catch { setError("Não foi possível enviar o código pelo WhatsApp da loja. Confira o número e tente mais tarde. Se continuar, fale com a loja."); setStatus("ready"); }
    finally { pending.current = false; }
  }

  async function verify() {
    if (pending.current || !verificationPhone) return;
    if (!/^\d{6}$/.test(code)) { setError("Digite o código de seis dígitos enviado ao seu WhatsApp."); return; }
    pending.current = true; setStatus("verifying"); setError(null);
    try {
      const result = await verifyBuyerWhatsAppLink(verificationPhone.phone, code, verificationPhone.merchantId);
      if (!result.linked) throw new Error("link_not_confirmed");
      setLink(result); setVerificationPhone(null); setCode(""); setPhone(""); setStatus("ready");
      onLinked?.();
    } catch { setError("Não foi possível confirmar o código. Confira os seis dígitos ou solicite um novo código."); setStatus("ready"); }
    finally { pending.current = false; }
  }

  const busy = status === "loading" || status === "sending" || status === "verifying";
  return <section className={styles.channel} aria-label="Mesma conta no WhatsApp" aria-busy={busy}>
    <h3>Mesma conta no site e WhatsApp</h3>
    <p>Vincule seu número para usar esta conta ao comprar pelo WhatsApp da loja. O cashback, quando disponível, também fica na mesma conta.</p>
    {status === "loading" ? <p role="status">Consultando vínculo do WhatsApp…</p> : link?.linked ? <p role="status"><strong>WhatsApp vinculado</strong> · {maskedPhone(link.phone)}</p> : status === "error" ? <button data-neu="secondary" className={styles.button} type="button" onClick={() => setAttempt(value => value + 1)}>Consultar novamente</button> : !verificationPhone ? <form className={styles.linkForm} onSubmit={event => { event.preventDefault(); void sendCode(); }}>
      <label>Número do WhatsApp<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+55 11 99999-9999" value={phone} disabled={busy} onChange={event => setPhone(event.target.value)} /></label>
      <button data-neu="secondary" className={styles.button} type="submit" disabled={busy || !phone.trim()}>{status === "sending" ? "Enviando código…" : "Enviar código"}</button>
    </form> : <form className={styles.linkForm} onSubmit={event => { event.preventDefault(); void verify(); }}>
      <p role="status">Código enviado ao WhatsApp {maskedPhone(verificationPhone.phone)}.</p>
      <label>Código de seis dígitos<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label>
      <button data-neu="primary" className={styles.button} type="submit" disabled={busy || code.length !== 6}>{status === "verifying" ? "Confirmando…" : "Confirmar WhatsApp"}</button>
      <button data-neu="secondary" className={styles.button} type="button" disabled={busy} onClick={() => { setVerificationPhone(null); setCode(""); setError(null); }}>Alterar número ou reenviar</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {!link?.linked && <p className={styles.notice}>O vínculo só é concluído após você confirmar o código. Isso não autoriza mensagens promocionais.</p>}
  </section>;
}
