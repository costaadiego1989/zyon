import React, { useEffect, useMemo, useRef, useState } from "react";
import { createDashboardApi } from "../../api-client.js";
import type { FiscalEnvironment, FiscalOwner } from "../../api/fiscal.js";
import { Button } from "../../components/Button.js";
import { FormField } from "../../components/FormField.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";

const pendingKey = "zyon:fiscal:olist:authorization";
export function isOlistFiscalCallback() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("olist_fiscal") === "1";
}
function message(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "fiscal_olist_issuer_mismatch") return "O CNPJ autorizado no ERP é diferente do emitente informado. Confira a conta e conecte novamente.";
  if (code === "fiscal_olist_authorization_expired_or_used") return "A autorização venceu ou já foi usada. Conecte sua conta novamente.";
  if (code === "fiscal_olist_connection_changed") return "A conexão mudou durante a autorização. Conecte sua conta novamente.";
  return "Não foi possível concluir esta etapa. Confira sua sessão e tente conectar novamente.";
}

export function FiscalOlistConnect({ apiBaseUrl, merchantId, environment, issuerTaxId, connectionId, owners, onChanged }: {
  apiBaseUrl: string; merchantId: string | null; environment: FiscalEnvironment; issuerTaxId: string; connectionId?: string;
  owners: Record<"stockOwner" | "emailOwner" | "whatsappOwner", FiscalOwner>; onChanged: () => void;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
  const [clientId, setClientId] = useState(""), [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState(""), [notificationUrl, setNotificationUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [rotate, setRotate] = useState(false);
  const alive = useRef(true), completionStarted = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setNotificationUrl(null);
    void api.getFiscalOlistOAuthConfiguration(environment).then(value => { if (current) setRedirectUri(value.redirectUri); }).catch(e => { if (current) setError(message(e)); });
    if (connectionId) void api.getFiscalOlistNotifications(connectionId, environment).then(value => { if (current) setNotificationUrl(value.notificationUrl); }).catch(() => { /* Reauthorization remains available for legacy credentials. */ });
    return () => { current = false; };
  }, [api, environment, connectionId]);
  useEffect(() => {
    if (!isOlistFiscalCallback() || completionStarted.current) return;
    completionStarted.current = true;
    const url = new URL(window.location.href), state = url.searchParams.get("state"), code = url.searchParams.get("code"), denied = url.searchParams.has("error");
    for (const field of ["olist_fiscal", "state", "code", "error", "error_description", "session_state", "iss"]) url.searchParams.delete(field);
    window.history.replaceState(window.history.state, "", url.toString());
    let pending: { state: string; merchantId: string; environment: string } | null = null;
    try { pending = JSON.parse(window.sessionStorage.getItem(pendingKey) ?? "null"); window.sessionStorage.removeItem(pendingKey); } catch { pending = null; }
    if (denied || !state || !code || pending?.state !== state || pending.merchantId !== merchantId || pending.environment !== environment) {
      setError("Esta autorização não foi iniciada nesta sessão ou foi recusada. Conecte sua conta novamente."); return;
    }
    setBusy(true); setError("");
    void api.completeFiscalOlist(environment, state, code).then(() => {
      if (alive.current) { setNotice("Conta autorizada. Confira a preparação fiscal."); onChanged(); }
    }).catch(e => { if (alive.current) setError(message(e)); }).finally(() => { if (alive.current) setBusy(false); });
  }, [api, environment, merchantId, onChanged]);

  async function authorize() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.authorizeFiscalOlist({ environment, issuerTaxId, clientId, clientSecret, connectionId, ...owners });
      if (!alive.current) return;
      const url = new URL(result.url);
      if (url.origin !== "https://accounts.tiny.com.br" || url.pathname !== "/realms/tiny/protocol/openid-connect/auth" || !/^[A-Za-z0-9_-]{43}$/.test(result.state) || url.searchParams.get("state") !== result.state) throw new Error("invalid_authorization_url");
      window.sessionStorage.setItem(pendingKey, JSON.stringify({ state: result.state, environment, merchantId }));
      setClientSecret("");
      window.location.assign(url.toString());
    } catch (e) { if (alive.current) { setError(message(e)); setBusy(false); } }
  }
  async function configure(shouldRotate: boolean) {
    if (!connectionId) return;
    setBusy(true); setError("");
    try {
      const value = await api.configureFiscalOlistNotifications(connectionId, environment, shouldRotate);
      if (alive.current) { setNotificationUrl(value.notificationUrl); setRotate(false); setNotice("Copie a URL e salve no aplicativo Webhooks do seu ERP."); }
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); if (alive.current) setNotice("URL copiada."); }
    catch { if (alive.current) setNotice("Selecione a URL acima e copie para o ERP."); }
  }
  return <div className="fiscal-olist-connect" style={{ gridColumn: "1 / -1", minWidth: 0 }}>
    <p>Crie um aplicativo privado na sua conta Tiny/Olist. Informe as chaves abaixo e autorize o acesso na tela do ERP. A Zyon guarda e renova os tokens.</p>
    <a href="https://api-docs.erp.olist.com/documentacao/comecando/criando-um-aplicativo" target="_blank" rel="noreferrer">Como criar o aplicativo no Tiny/Olist</a>
    <FormField label="URL de redirecionamento do aplicativo" value={redirectUri} onChange={() => {}} inputProps={{ readOnly: true }} hint="Cadastre esta URL no aplicativo do ERP, neste ambiente." />
    <Button variant="outline" disabled={!redirectUri || busy} onClick={() => void copy(redirectUri)}>Copiar redirecionamento</Button>
    <FormField label="Identificação do aplicativo Tiny/Olist" value={clientId} onChange={setClientId} disabled={busy} maxLength={256} />
    <FormField label="Segredo do aplicativo Tiny/Olist" type="password" value={clientSecret} onChange={setClientSecret} disabled={busy} maxLength={4096} inputProps={{ autoComplete: "new-password" }} />
    <Button disabled={busy || !merchantId || !issuerTaxId.trim() || !clientId.trim() || !clientSecret.trim() || !redirectUri} loading={busy} onClick={() => void authorize()}>{connectionId ? "Autorizar conta novamente no Tiny/Olist" : "Autorizar conta no Tiny/Olist"}</Button>
    {connectionId && <div aria-label="Notificações Tiny/Olist">
      <h3>Receber atualização das notas</h3>
      <p>No ERP, instale o aplicativo Webhooks. Em Configurações → Geral → Webhooks, ative as notificações de notas fiscais autorizadas e salve a URL abaixo.</p>
      <p>Se seu plano não tiver esse aplicativo, a Zyon continua consultando suas notas automaticamente.</p>
      {notificationUrl ? <>
        <FormField label="URL privada de notificação Tiny/Olist" value={notificationUrl} onChange={() => {}} inputProps={{ readOnly: true }} hint="Esta URL é secreta. Use somente na configuração da sua conta ERP." />
        <Button variant="outline" disabled={busy} onClick={() => void copy(notificationUrl)}>Copiar URL de notificação</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setRotate(true)}>Gerar nova URL</Button>
      </> : <Button variant="outline" disabled={busy} onClick={() => void configure(false)}>Preparar URL de notificação</Button>}
    </div>}
    {busy && <p role="status">Preparando conexão Tiny/Olist…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <ConfirmDialog open={rotate} title="Substituir URL de notificação?" description="A URL anterior deixará de funcionar. Depois, salve a nova URL no aplicativo Webhooks do ERP." confirmLabel="Substituir URL" variant="default" busy={busy} onCancel={() => setRotate(false)} onConfirm={() => void configure(true)} />
  </div>;
}
