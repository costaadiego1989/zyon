import React, { useEffect, useMemo, useRef, useState } from "react";
import { createDashboardApi } from "../../api-client.js";
import { fiscalDashboardEnvironment } from "../../lib/fiscal-environment.js";
import type {
  FiscalConnection,
  FiscalEnvironment,
  FiscalProvider,
  FiscalProviderSummary,
  FiscalProfiles,
  FiscalSetup,
  FiscalPaymentSource,
  FiscalTemplates,
  FiscalOwner,
} from "../../api/fiscal.js";
import { FiscalApiError, fiscalPaymentSourceLabel } from "../../api/fiscal.js";
import type { ErpConnectionDTO } from "../../api/endpoints/inventory.js";
import { PageHeader } from "../../components/PageHeader.js";
import { SetupGuide } from "../../components/SetupGuide.js";
import { Button } from "../../components/Button.js";
import {
  FormField,
  FormSelect,
  FormTextarea,
} from "../../components/FormField.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import {
  buildFiscalProfile,
  emptyItem,
  fiscalCredentialSecret,
  fiscalErrorText,
  fiscalReasonText,
  operationFields,
  profileEditor,
  providerLabels,
  readinessLabel,
  taxFields,
  type FiscalItemEditor,
} from "./fiscal-ui.js";
import "../../components/configuration-form.css";
import "./fiscal.css";
import { FiscalOlistConnect, isOlistFiscalCallback } from "./FiscalOlistConnect.js";

export function FiscalSettingsPage({
  apiBaseUrl,
  merchantId,
  intentId,
  initialEnvironment = "homologation",
}: {
  apiBaseUrl: string;
  merchantId: string | null;
  intentId?: string;
  initialEnvironment?: FiscalEnvironment;
}) {
  const api = useMemo(
    () => createDashboardApi({ baseUrl: apiBaseUrl }),
    [apiBaseUrl]
  );
  const [selectedEnvironment, setEnvironment] =
      useState<FiscalEnvironment>(initialEnvironment),
    [provider, setProvider] = useState<FiscalProvider>(() => isOlistFiscalCallback() ? "tiny" : "focus");
  const environment = fiscalDashboardEnvironment(selectedEnvironment);
  const [providers, setProviders] = useState<FiscalProviderSummary[]>([]),
    [connection, setConnection] = useState<FiscalConnection | null>(null),
    [profiles, setProfiles] = useState<FiscalProfiles | null>(null),
    [setup, setSetup] = useState<FiscalSetup | null>(null),
    [sources, setSources] = useState<FiscalPaymentSource[]>([]),
    [erps, setErps] = useState<ErpConnectionDTO[]>([]),
    [templates, setTemplates] = useState<FiscalTemplates | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [disconnect, setDisconnect] = useState(false);
  const [connectionLoadFailed, setConnectionLoadFailed] = useState(false),
    [erpLoadFailed, setErpLoadFailed] = useState(false),
    [preparationIssues, setPreparationIssues] = useState<string[]>([]);
  const generation = useRef(0),
    scope = `${merchantId}:${environment}:${provider}`;
  const providerChosen = useRef(false);
  useEffect(() => {
    providerChosen.current = isOlistFiscalCallback();
  }, [merchantId, environment]);
  const [issuerTaxId, setIssuerTaxId] = useState(""),
    [secret, setSecret] = useState(""),
    [appKey, setAppKey] = useState(""),
    [erpId, setErpId] = useState(""),
    [owners, setOwners] = useState({
      stockOwner: "zyon",
      emailOwner: "zyon",
      whatsappOwner: "zyon",
    } as Record<"stockOwner" | "emailOwner" | "whatsappOwner", FiscalOwner>);
  const [refreshToken, setRefreshToken] = useState(""),
    [tokenExpiry, setTokenExpiry] = useState(""),
    [clientSecret, setClientSecret] = useState("");
  const [companyId, setCompanyId] = useState(""),
    [timeZone, setTimeZone] = useState(""),
    [hookHeader, setHookHeader] = useState(""),
    [hookSecret, setHookSecret] = useState("");
  const [regime, setRegime] = useState(""),
    [operation, setOperation] = useState<Record<string, string>>({}),
    [items, setItems] = useState<FiscalItemEditor[]>([]),
    [confirmProfile, setConfirmProfile] = useState(false);
  const [paymentMappings, setPaymentMappings] = useState<
    Array<{ code: string; id: string; receiptId: string }>
  >([]);
  const [sourceIndex, setSourceIndex] = useState(""),
    [paymentEnvironment, setPaymentEnvironment] = useState("test"),
    [acquirer, setAcquirer] = useState(""),
    [paymentZone, setPaymentZone] = useState(""),
    [cryptoDescription, setCryptoDescription] = useState(""),
    [confirmPayment, setConfirmPayment] = useState(false);
  const [accountConfirmed, setAccountConfirmed] = useState(false),
    [policyName, setPolicyName] = useState(""),
    [expires, setExpires] = useState(""),
    [certificateExpiry, setCertificateExpiry] = useState(""),
    [effects, setEffects] = useState<Record<string, boolean>>({
      stockOnSave: false,
      stockOnAuthorize: false,
      stockOnCancel: false,
      accountsOnSave: false,
      accountsOnAuthorize: false,
      accountsOnCancel: false,
      automaticEmail: false,
      automaticInvoiceGeneration: false,
      automaticInvoiceAuthorization: false,
    });
  const [emailSubject, setEmailSubject] = useState(""),
    [emailBody, setEmailBody] = useState(""),
    [whatsappBody, setWhatsappBody] = useState("");
  useEffect(() => {
    setSecret("");
    setAppKey("");
    setRefreshToken("");
    setTokenExpiry("");
    setClientSecret("");
    setHookSecret("");
    setNotice("");
    setConfirmProfile(false);
    setConfirmPayment(false);
    setAccountConfirmed(false);
    setConnection(null);
    setSetup(null);
    setProfiles(null);
    setItems([]);
    setOperation({});
    setRegime("");
    setIssuerTaxId("");
    setSourceIndex("");
    setErpId("");
    setErps([]);
    setTemplates(null);
    setSources([]);
    setOwners({ stockOwner: "zyon", emailOwner: "zyon", whatsappOwner: "zyon" });
    setConnectionLoadFailed(false);
    setErpLoadFailed(false);
    setPreparationIssues([]);
    setBusy(false);
  }, [scope]);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    if (!merchantId) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const results = await Promise.allSettled([
          api.getFiscalProviders(environment),
          api.getFiscalConnection(environment),
          api.getFiscalProfiles(environment, provider),
          api.getFiscalTemplates(),
          api.getFiscalPaymentSources(environment, intentId),
          provider === "bling" ? api.getErpConnections(merchantId) : Promise.resolve([] as ErpConnectionDTO[]),
        ]);
        if (current !== generation.current) return;
        const authFailure = results.find(result => result.status === "rejected" && result.reason instanceof FiscalApiError &&
          ["unauthenticated", "forbidden"].includes(result.reason.kind));
        if (authFailure?.status === "rejected") throw authFailure.reason;
        const [catalogResult, connectionResult, profileResult, templateResult, sourceResult, erpResult] = results;
        const c = connectionResult.status === "fulfilled" ? connectionResult.value : null;
        const p = profileResult.status === "fulfilled" ? profileResult.value : null;
        const t = templateResult.status === "fulfilled" ? templateResult.value : null;
        const erpValues = erpResult.status === "fulfilled" ? erpResult.value : [];
        let setupValue: FiscalSetup | null = null;
        let setupFailed = false;
        if (c?.provider === provider) {
          try { setupValue = await api.getFiscalSetup(c.id, environment); }
          catch (e) {
            if (e instanceof FiscalApiError && ["unauthenticated", "forbidden"].includes(e.kind)) throw e;
            setupFailed = true;
          }
        }
        if (current !== generation.current) return;
        if (c && !providerChosen.current && c.provider !== provider) {
          setProvider(c.provider);
          return;
        }
        setConnectionLoadFailed(connectionResult.status === "rejected");
        setErpLoadFailed(erpResult.status === "rejected");
        setPreparationIssues([
          ...(catalogResult.status === "rejected" ? ["emissores disponíveis"] : []),
          ...(profileResult.status === "rejected" ? ["produtos e impostos"] : []),
          ...(sourceResult.status === "rejected" ? ["pagamentos"] : []),
          ...(templateResult.status === "rejected" ? ["mensagens"] : []),
          ...(setupFailed ? ["dados da empresa"] : []),
        ]);
        setProviders(catalogResult.status === "fulfilled" ? catalogResult.value.providers : []);
        setConnection(c);
        setProfiles(p);
        setTemplates(t);
        setSources(sourceResult.status === "fulfilled" ? sourceResult.value : []);
        setSetup(setupValue);
        setErps(erpValues);
        const availableBling = erpValues.filter(account => account.provider === "bling" && account.status === "connected" && !account.requiresReconnect);
        const previousErpId = c?.provider === "bling" ? c.erpConnectionId : null;
        setErpId(previousErpId
          ? availableBling.some(account => account.id === previousErpId) ? previousErpId : ""
          : availableBling.length === 1 ? availableBling[0].id : "");
        if (c?.provider === provider) {
          setIssuerTaxId(c.issuerTaxId);
          setOwners({
            stockOwner: c.stockOwner,
            emailOwner: c.emailOwner,
            whatsappOwner: c.whatsappOwner,
          });
        }
        setCompanyId(setupValue?.companyId ?? "");
        setTimeZone(setupValue?.fiscalTimeZone ?? "");
        const editor = profileEditor(p?.profile ?? null);
        setItems(editor.items);
        setOperation(editor.operation);
        setRegime(p?.profile?.issuerRegime ?? "");
        setPolicyName(
          String(
            p?.profile?.itemRules.policyVersion ??
              setupValue?.accountEvidence?.policyVersion ??
              ""
          )
        );
        setPaymentMappings(
          Object.entries(
            (p?.profile?.itemRules.paymentMappings ?? {}) as Record<
              string,
              {
                id?: number;
                meioPagamentoId?: number;
                formaRecebimentoId?: number;
              }
            >
          ).map(([code, v]) => ({
            code,
            id: String(v.id ?? v.meioPagamentoId ?? ""),
            receiptId: String(v.formaRecebimentoId ?? ""),
          }))
        );
        setEmailSubject(t?.email.subject ?? "");
        setEmailBody(t?.email.body ?? "");
        setWhatsappBody(t?.whatsapp.body ?? "");
      } catch (e) {
        if (current === generation.current) setError(fiscalErrorText(e));
      } finally {
        if (current === generation.current) setLoading(false);
      }
    })();
    return () => {
      generation.current++;
    };
  }, [api, merchantId, environment, provider, revision, intentId]);
  async function run(work: () => Promise<unknown>, message: string) {
    const current = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (current === generation.current) {
        setNotice(message);
        setSecret("");
        setAppKey("");
        setRefreshToken("");
        setClientSecret("");
        setHookSecret("");
        setRevision((x) => x + 1);
        return true;
      }
    } catch (e) {
      if (current === generation.current) setError(fiscalErrorText(e));
    } finally {
      if (current === generation.current) setBusy(false);
    }
    return false;
  }
  const selectedConnection =
    connection?.provider === provider ? connection : null;
  const availableBling = erps.filter(account => account.provider === "bling" && account.status === "connected" && !account.requiresReconnect);
  const needsBlingReconnect = !availableBling.length && erps.some(account => account.provider === "bling");
  const credential = () => ({
    kind:
      provider === "omie"
        ? ("app_credentials" as const)
        : provider === "tiny"
        ? ("oauth" as const)
        : ("company_token" as const),
    secret: fiscalCredentialSecret(provider, {
      token: secret,
      refreshToken,
      expiresAt: tokenExpiry,
      appId: appKey,
      clientSecret,
      environment,
      issuerTaxId,
    }),
  });
  const updateItem = (index: number, patch: Partial<FiscalItemEditor>) =>
    setItems((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  const validCredential =
    !!secret &&
    (provider === "focus" ||
      (!!refreshToken &&
        !!tokenExpiry &&
        !!appKey &&
        (provider !== "tiny" || !!clientSecret)));
  const validConnection =
    !connectionLoadFailed && !!issuerTaxId.trim() && (provider === "bling"
      ? !erpLoadFailed && availableBling.some(account => account.id === erpId) : validCredential);
  const connectionHelp = connectionLoadFailed
    ? "Atualize os dados da conexão fiscal antes de continuar."
    : provider === "bling" && erpLoadFailed ? "Atualize suas contas Bling para continuar."
    : provider === "bling" && !availableBling.length ? "Conecte ou reconecte sua conta Bling nas integrações ERP para continuar."
    : provider === "bling" && !erpId ? "Selecione a conta Bling que deve emitir as notas."
    : !issuerTaxId.trim() ? "Informe o CNPJ da empresa para continuar."
    : provider !== "bling" && !validCredential ? "Preencha as credenciais da sua conta para continuar." : "";
  const ready =
    selectedConnection?.readiness.length &&
    selectedConnection.readiness.every((r) => r.status === "verified");
  return (
    <div className="fiscal-page">
      <PageHeader
        title="Configuração fiscal"
        description="Prepare sua empresa para emitir notas nas novas vendas pagas."
      />
      <SetupGuide title="Como preparar a emissão de notas" steps={[
        {title:"Conecte o emissor da sua empresa",description:"Escolha seu ERP ou a Focus NF-e. Informe o CNPJ da empresa e conecte a conta que você usa para emitir notas."},
        {title:"Revise os dados com seu contador",description:"Confira os produtos, impostos e formas de pagamento. As pendências mostram o que falta antes de ativar."},
        {title:"Ative quando tudo estiver pronto",description:"Verifique a preparação e ative a emissão automática. Ela vale para novas vendas pagas; vendas antigas não recebem nota por esta ativação."},
      ]}/>
      {!merchantId ? (
        <p role="alert">Faça login para configurar a emissão fiscal.</p>
      ) : (
        <>
          <div className="configuration-form">
            <div className="configuration-form__grid">
              {!import.meta.env.PROD && <FormSelect
                label="Ambiente fiscal"
                value={environment}
                onChange={(v) => setEnvironment(v as FiscalEnvironment)}
                options={[
                  {
                    value: "homologation",
                    label: "Homologação · sem validade fiscal",
                  },
                  { value: "production", label: "Produção" },
                ]}
                disabled={busy}
              />}
              <FormSelect
                label="Emissor fiscal"
                value={provider}
                onChange={(v) => {
                  providerChosen.current = true;
                  setProvider(v as FiscalProvider);
                }}
                options={
                  providers.length
                    ? providers.map((p) => ({ value: p.id, label: p.label }))
                    : Object.entries(providerLabels).map(([value, label]) => ({
                        value,
                        label,
                      }))
                }
                disabled={busy}
              />
            </div>
          </div>
          {loading ? (
            <p role="status">Carregando configuração fiscal…</p>
          ) : (
            <>
              {error && (
                <div className="fiscal-state" role="alert">
                  <p>{error}</p>
                  <Button
                    variant="outline"
                    onClick={() => setRevision((x) => x + 1)}
                    disabled={busy}
                  >
                    Atualizar dados
                  </Button>
                </div>
              )}
              {notice && <p role="status">{notice}</p>}
              {!error.startsWith("Acesso negado") &&
                !error.startsWith("Sessão expirada") && (
                  <>
                    <section
                      className="fiscal-section configuration-form"
                      aria-label="Conexão fiscal"
                    >
                      <h2>Conta e emitente</h2>
                      {connectionLoadFailed && <div role="alert">
                        <p>Não conseguimos carregar a conexão fiscal. Atualize os dados para continuar.</p>
                        <Button variant="outline" onClick={() => setRevision(value => value + 1)}>Atualizar conexão</Button>
                      </div>}
                      <p>
                        {selectedConnection
                          ? `Conta ${providerLabels[provider]} conectada${
                              selectedConnection.isActive
                                ? " · Emissão automática ativa"
                                : " · Emissão ainda não ativa"
                            }.`
                          : `Conecte sua conta ${providerLabels[provider]} para emitir as notas das suas vendas.`}{" "}
                        O certificado e sua senha ficam no painel do provedor.
                      </p>
                      {connection && connection.provider !== provider && (
                        <p>
                          Sua conta {providerLabels[connection.provider]} está vinculada à emissão.
                          Ao trocar o emissor, suas notas e referências anteriores serão preservadas.
                        </p>
                      )}
                      <div className="configuration-form__grid">
                        <FormField
                          label="CNPJ da empresa emitente"
                          value={issuerTaxId}
                          onChange={setIssuerTaxId}
                          hint="Aceita CNPJ alfanumérico. Use a identidade cadastrada no provedor."
                          disabled={busy}
                        />
                        {provider === "tiny" ? (
                          <FiscalOlistConnect key={scope} apiBaseUrl={apiBaseUrl} merchantId={merchantId} environment={environment} issuerTaxId={issuerTaxId} connectionId={selectedConnection?.id} owners={owners} onChanged={() => { setNotice("Conta Tiny/Olist autorizada. Confira a preparação fiscal."); setRevision(r => r + 1); }} />
                        ) : provider === "bling" ? (
                          <FormSelect
                            label="Conexão Bling existente"
                            value={erpId}
                            onChange={setErpId}
                            options={[
                              { value: "", label: "Selecione sua conta Bling" },
                              ...availableBling
                                .map((c, i) => ({
                                  value: c.id,
                                  label: `Bling ${i + 1} · ${
                                    c.status === "connected"
                                      ? "conectado"
                                      : "reconexão necessária"
                                  }`,
                                })),
                            ]}
                            disabled={busy || erpLoadFailed || !availableBling.length}
                            hint={availableBling.length === 1 ? "Sua conta Bling conectada já está selecionada." : "Escolha a conta Bling que você já conectou à Zyon."}
                          />
                        ) : (
                          <>
                            {provider !== "focus" && (
                              <>
                                <FormField
                                  label={
                                    provider === "omie"
                                      ? "Identificação do aplicativo Omie"
                                      : "Identificação do aplicativo OAuth Olist"
                                  }
                                  value={appKey}
                                  onChange={setAppKey}
                                />
                                <FormField
                                  label="Token de renovação fiscal"
                                  type="password"
                                  value={refreshToken}
                                  onChange={setRefreshToken}
                                  inputProps={{ autoComplete: "new-password" }}
                                />
                                <FormField
                                  label="Token fiscal válido até"
                                  type="date"
                                  value={tokenExpiry}
                                  onChange={setTokenExpiry}
                                />
                              </>
                            )}
                            <FormField
                              label={
                                provider === "focus"
                                  ? "Token da empresa Focus NF-e"
                                  : provider === "omie"
                                  ? "Token fiscal do aplicativo Omie"
                                  : "Token de acesso fiscal OAuth v3 Olist"
                              }
                              type="password"
                              value={secret}
                              onChange={setSecret}
                              hint={
                                provider === "focus"
                                  ? "Token da empresa neste ambiente. Não use token master."
                                  : "Use a autorização fiscal suportada. Credenciais antigas de estoque não comprovam a permissão fiscal."
                              }
                              inputProps={{ autoComplete: "new-password" }}
                            />
                          </>
                        )}
                        {(
                          ["stockOwner", "emailOwner", "whatsappOwner"] as const
                        ).map((key) => (
                          <FormSelect
                            key={key}
                            disabled={busy}
                            label={
                              {
                                stockOwner: "Responsável pelo estoque",
                                emailOwner: "Responsável pelo e-mail",
                                whatsappOwner: "Responsável pelo WhatsApp",
                              }[key]
                            }
                            value={owners[key]}
                            onChange={(v) =>
                              setOwners((o) => ({
                                ...o,
                                [key]: v as FiscalOwner,
                              }))
                            }
                            options={[
                              { value: "zyon", label: "Zyon" },
                              { value: "provider", label: "Provedor" },
                            ]}
                          />
                        ))}
                      </div>
                      {provider === "bling" && erpLoadFailed && <div role="alert">
                        <p>Não conseguimos carregar suas contas Bling.</p>
                        <Button variant="outline" onClick={() => setRevision(value => value + 1)}>Atualizar contas Bling</Button>
                      </div>}
                      {provider === "bling" && !erpLoadFailed && !availableBling.length && <p role="status">
                        {needsBlingReconnect ? "Sua autorização Bling precisa ser renovada. " : "Você ainda não tem uma conta Bling conectada. "}
                        <a href="#erp-integrations">{needsBlingReconnect ? "Reconectar conta Bling" : "Conectar conta Bling"}</a>
                      </p>}
                      {connectionHelp && <p id="fiscal-connect-help" role="status">{connectionHelp}</p>}
                      <div className="fiscal-actions">
                        {provider !== "tiny" && <Button
                          disabled={busy || !validConnection}
                          aria-describedby={connectionHelp ? "fiscal-connect-help" : undefined}
                          loading={busy}
                          onClick={() =>
                            run(
                              () =>
                                api.connectFiscal({
                                  provider,
                                  environment,
                                  issuerTaxId,
                                  ...owners,
                                  ...(provider === "bling"
                                    ? { erpConnectionId: erpId }
                                    : { credential: credential() }),
                                } as Parameters<typeof api.connectFiscal>[0]),
                              "Conexão salva. Verifique a preparação antes de ativar."
                            )
                          }
                        >
                          Conectar emissor
                        </Button>}
                        {selectedConnection && (
                          <>
                            {provider !== "tiny" && <Button
                              variant="outline"
                              disabled={
                                busy ||
                                (provider === "bling" ? !validConnection : !validCredential)
                              }
                              onClick={() =>
                                run(
                                  () =>
                                    api.reconnectFiscalConnection(
                                      selectedConnection.id,
                                      environment,
                                      provider === "bling"
                                        ? undefined
                                        : credential()
                                    ),
                                  "Reconexão registrada. Verifique a preparação."
                                )
                              }
                            >
                              Reconectar conta
                            </Button>}
                            <Button
                              variant="ghost"
                              onClick={() => setDisconnect(true)}
                              disabled={busy}
                            >
                              Desconectar
                            </Button>
                          </>
                        )}
                      </div>
                      {preparationIssues.length > 0 && <div className="fiscal-actions" role="status">
                        <p>Não conseguimos carregar: {preparationIssues.join(", ")}. Você pode conectar a conta e atualizar esses dados depois.</p>
                        <Button variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}>Atualizar preparação</Button>
                      </div>}
                    </section>
                    {selectedConnection && (
                      <>
                        <section
                          className="fiscal-section configuration-form"
                          aria-label="Preparação fiscal"
                        >
                          <h2>Preparação e ativação</h2>
                          <p>
                            A confirmação do responsável não substitui a
                            verificação da conta, certificado e ambiente pelo
                            provedor.
                          </p>
                          <ul className="fiscal-readiness">
                            {selectedConnection.readiness.map((r) => (
                              <li key={r.code}>
                                <strong>{readinessLabel[r.code]}</strong>
                                <span>
                                  {r.status === "verified"
                                    ? "Verificado"
                                    : r.status === "unsupported"
                                    ? "Não suportado"
                                    : "Pendente"}
                                  {r.reasonCode
                                    ? ` · ${fiscalReasonText(r.reasonCode)}`
                                    : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {selectedConnection.activatedAt && (
                            <p>
                              Ativação:{" "}
                              {new Date(
                                selectedConnection.activatedAt
                              ).toLocaleString("pt-BR")}
                              . Vendas anteriores permanecem inelegíveis.
                            </p>
                          )}
                          <div className="fiscal-actions">
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () =>
                                    api.inspectFiscalConnection(
                                      selectedConnection.id,
                                      environment
                                    ),
                                  "Preparação consultada."
                                )
                              }
                            >
                              Verificar preparação
                            </Button>
                            <Button
                              disabled={
                                busy || !ready || selectedConnection.isActive
                              }
                              onClick={() =>
                                run(
                                  () =>
                                    api.activateFiscalConnection(
                                      selectedConnection.id,
                                      environment
                                    ),
                                  "Emissão automática ativada para vendas futuras."
                                )
                              }
                            >
                              Ativar emissão
                            </Button>
                          </div>
                        </section>
                        <section className="fiscal-section configuration-form">
                          <h2>Configuração da empresa</h2>
                          <div className="configuration-form__grid">
                            {provider === "focus" && (
                              <FormField
                                label="Identificação da empresa na Focus"
                                value={companyId}
                                onChange={setCompanyId}
                              />
                            )}
                            <FormField
                              label="Fuso horário fiscal"
                              value={timeZone}
                              onChange={setTimeZone}
                              placeholder="America/Sao_Paulo"
                            />
                            {provider === "focus" && (
                              <>
                                <FormField
                                  label="Nome do cabeçalho do webhook Focus"
                                  value={hookHeader}
                                  onChange={setHookHeader}
                                />
                                <FormField
                                  label="Segredo do webhook Focus"
                                  type="password"
                                  value={hookSecret}
                                  onChange={setHookSecret}
                                  hint={
                                    setup?.focusWebhookConfigured
                                      ? "Já configurado. Preencha somente para substituir."
                                      : "Configure o mesmo segredo no painel Focus."
                                  }
                                />
                              </>
                            )}
                          </div>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              run(
                                () =>
                                  api.saveFiscalSetup(selectedConnection.id, {
                                    environment,
                                    ...(companyId ? { companyId } : {}),
                                    ...(timeZone
                                      ? { fiscalTimeZone: timeZone }
                                      : {}),
                                    ...(hookSecret
                                      ? {
                                          focusWebhook: {
                                            authorizationHeader: hookHeader,
                                            authorization: hookSecret,
                                          },
                                        }
                                      : {}),
                                  }),
                                "Configuração da empresa salva."
                              )
                            }
                          >
                            Salvar empresa
                          </Button>
                        </section>
                      </>
                    )}
                    <section
                      className="fiscal-section configuration-form"
                      aria-label="Perfil tributário"
                    >
                      <h2>Perfil fiscal do lojista ou contador</h2>
                      <p>
                        Sem configuração válida do produto, a compra continua
                        permitida e a emissão fica pendente. Informe os valores
                        revisados pelo responsável, sem alíquotas presumidas.
                      </p>
                      {profiles?.confirmedProfile && (
                        <p>
                          Última confirmação: versão{" "}
                          {profiles.confirmedProfile.version},{" "}
                          {new Date(
                            profiles.confirmedProfile.confirmedAt!
                          ).toLocaleString("pt-BR")}
                          .
                        </p>
                      )}
                      {profiles?.profile && (
                        <p>
                          Configuração salva: versão {profiles.profile.version}{" "}
                          ·{" "}
                          {profiles.profile.confirmedAt
                            ? "confirmada"
                            : "rascunho pendente de confirmação"}
                          .
                        </p>
                      )}
                      {!profiles?.supportedContract ? (
                        <p>
                          {selectedConnection
                            ? "Confira a preparação da conta para consultar os produtos e impostos disponíveis."
                            : "Conecte o emissor para continuar a configuração dos produtos e impostos."}
                        </p>
                      ) : (
                        <>
                          {provider !== "focus" && (
                            <FormField
                              label="Revisão da configuração fiscal ERP"
                              value={policyName}
                              onChange={setPolicyName}
                              hint="Nome definido pelo responsável. Ao mudar, salve e confirme uma nova versão antes de confirmar os efeitos do ERP."
                            />
                          )}
                          {provider !== "focus" &&
                            policyName !==
                              profiles.confirmedProfile?.itemRules
                                .policyVersion && (
                              <p role="status">
                                Revisão editada ainda não confirmada. Salve e
                                confirme o perfil antes de confirmar os efeitos
                                do ERP.
                              </p>
                            )}
                          <FormSelect
                            label="Regime tributário"
                            value={regime}
                            onChange={setRegime}
                            options={[
                              {
                                value: "",
                                label: "Selecione o regime da empresa",
                              },
                              ...profiles.supportedContract.issuerRegimes.map(
                                (value) => ({
                                  value,
                                  label:
                                    (
                                      {
                                        simples_nacional: "Simples Nacional",
                                        lucro_presumido: "Lucro presumido",
                                        lucro_real: "Lucro real",
                                      } as Record<string, string>
                                    )[value] ?? value,
                                })
                              ),
                            ]}
                          />
                          <h3>Operação de venda de mercadorias</h3>
                          <div className="configuration-form__grid">
                            {operationFields[provider].map((field) =>
                              field.options || field.kind === "boolean" ? (
                                <FormSelect
                                  key={field.key}
                                  label={field.label}
                                  value={operation[field.key] ?? ""}
                                  onChange={(v) =>
                                    setOperation((o) => ({
                                      ...o,
                                      [field.key]: v,
                                    }))
                                  }
                                  options={[
                                    { value: "", label: "Selecione" },
                                    ...(field.kind === "boolean"
                                      ? [
                                          { value: "true", label: "Sim" },
                                          { value: "false", label: "Não" },
                                        ]
                                      : (field.options ?? []).map((value) => ({
                                          value,
                                          label: value,
                                        }))),
                                  ]}
                                />
                              ) : (
                                <FormField
                                  key={field.key}
                                  label={field.label}
                                  type={
                                    field.kind === "number" ? "number" : "text"
                                  }
                                  value={operation[field.key] ?? ""}
                                  onChange={(v) =>
                                    setOperation((o) => ({
                                      ...o,
                                      [field.key]: v,
                                    }))
                                  }
                                />
                              )
                            )}
                          </div>
                          {items.map((item, index) => (
                            <div className="fiscal-item" key={index}>
                              <h3>Produto {index + 1}</h3>
                              <div className="configuration-form__grid">
                                {[
                                  ["sku", "SKU do produto"],
                                  ["ncm", "NCM"],
                                  ["cfop", "CFOP"],
                                  ["origin", "Origem da mercadoria"],
                                  ["unit", "Unidade comercial"],
                                  ...(provider !== "focus"
                                    ? [
                                        [
                                          "productId",
                                          "Código do produto no ERP",
                                        ],
                                      ]
                                    : []),
                                  ...(provider === "bling"
                                    ? [
                                        [
                                          "natureId",
                                          "Código da natureza do produto no Bling",
                                        ],
                                      ]
                                    : []),
                                ].map(([key, label]) => (
                                  <FormField
                                    key={key}
                                    label={label}
                                    value={
                                      item[
                                        key as keyof Omit<
                                          FiscalItemEditor,
                                          "taxes"
                                        >
                                      ]
                                    }
                                    onChange={(v) =>
                                      updateItem(index, { [key]: v })
                                    }
                                  />
                                ))}
                              </div>
                              {item.taxes.map((tax, t) => (
                                <div className="fiscal-tax" key={t}>
                                  <FormSelect
                                    label={`Tributo ${t + 1} do produto ${
                                      index + 1
                                    }`}
                                    value={tax.key}
                                    onChange={(v) =>
                                      updateItem(index, {
                                        taxes: item.taxes.map((x, j) =>
                                          j === t ? { ...x, key: v } : x
                                        ),
                                      })
                                    }
                                    options={[
                                      {
                                        value: "",
                                        label: "Selecione o campo fiscal",
                                      },
                                      ...[
                                        ...new Set(
                                          [
                                            ...taxFields[provider],
                                            tax.key,
                                          ].filter(Boolean)
                                        ),
                                      ].map((value) => ({
                                        value,
                                        label: value.replaceAll("_", " "),
                                      })),
                                    ]}
                                  />
                                  <FormField
                                    label={`Valor do tributo ${
                                      t + 1
                                    } do produto ${index + 1}`}
                                    value={tax.value}
                                    onChange={(v) =>
                                      updateItem(index, {
                                        taxes: item.taxes.map((x, j) =>
                                          j === t ? { ...x, value: v } : x
                                        ),
                                      })
                                    }
                                  />
                                  <FormSelect
                                    label={`Tipo do valor ${t + 1} do produto ${
                                      index + 1
                                    }`}
                                    value={tax.numeric ? "number" : "text"}
                                    onChange={(v) =>
                                      updateItem(index, {
                                        taxes: item.taxes.map((x, j) =>
                                          j === t
                                            ? { ...x, numeric: v === "number" }
                                            : x
                                        ),
                                      })
                                    }
                                    options={[
                                      {
                                        value: "text",
                                        label: "Código / texto",
                                      },
                                      {
                                        value: "number",
                                        label: "Número / alíquota",
                                      },
                                    ]}
                                  />
                                  <Button
                                    variant="ghost"
                                    onClick={() =>
                                      updateItem(index, {
                                        taxes: item.taxes.filter(
                                          (_, j) => j !== t
                                        ),
                                      })
                                    }
                                  >
                                    Remover tributo {t + 1}
                                  </Button>
                                </div>
                              ))}
                              <div className="fiscal-actions">
                                <Button
                                  variant="outline"
                                  onClick={() =>
                                    updateItem(index, {
                                      taxes: [
                                        ...item.taxes,
                                        { key: "", value: "", numeric: false },
                                      ],
                                    })
                                  }
                                >
                                  Adicionar tributo ao produto {index + 1}
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    setItems((rows) =>
                                      rows.filter((_, i) => i !== index)
                                    )
                                  }
                                >
                                  Remover produto {index + 1}
                                </Button>
                              </div>
                            </div>
                          ))}
                          {(provider === "bling" || provider === "tiny") && (
                            <>
                              <h3>Formas de pagamento no ERP</h3>
                              <p>
                                Relacione o código fiscal à forma cadastrada no
                                seu ERP. Isso não altera o comprovante original.
                              </p>
                              {paymentMappings.map((m, i) => (
                                <div
                                  className="configuration-form__grid"
                                  key={i}
                                >
                                  <FormSelect
                                    label={`Código fiscal do pagamento ${
                                      i + 1
                                    }`}
                                    value={m.code}
                                    onChange={(v) =>
                                      setPaymentMappings((rows) =>
                                        rows.map((row, j) =>
                                          j === i ? { ...row, code: v } : row
                                        )
                                      )
                                    }
                                    options={[
                                      { value: "", label: "Selecione" },
                                      { value: "03", label: "03 · Crédito" },
                                      { value: "04", label: "04 · Débito" },
                                      { value: "15", label: "15 · Boleto" },
                                      {
                                        value: "17",
                                        label: "17 · Pix dinâmico",
                                      },
                                      {
                                        value: "20",
                                        label: "20 · Pix estático",
                                      },
                                      { value: "99", label: "99 · Outros" },
                                    ]}
                                  />
                                  <FormField
                                    label={`Código da forma de pagamento no ERP ${
                                      i + 1
                                    }`}
                                    value={m.id}
                                    onChange={(v) =>
                                      setPaymentMappings((rows) =>
                                        rows.map((row, j) =>
                                          j === i ? { ...row, id: v } : row
                                        )
                                      )
                                    }
                                  />
                                  {provider === "tiny" && (
                                    <FormField
                                      label={`Código da forma de recebimento Olist ${
                                        i + 1
                                      }`}
                                      value={m.receiptId}
                                      onChange={(v) =>
                                        setPaymentMappings((rows) =>
                                          rows.map((row, j) =>
                                            j === i
                                              ? { ...row, receiptId: v }
                                              : row
                                          )
                                        )
                                      }
                                    />
                                  )}
                                  <Button
                                    variant="ghost"
                                    onClick={() =>
                                      setPaymentMappings((rows) =>
                                        rows.filter((_, j) => j !== i)
                                      )
                                    }
                                  >
                                    Remover forma de pagamento {i + 1}
                                  </Button>
                                </div>
                              ))}
                              <Button
                                variant="outline"
                                onClick={() =>
                                  setPaymentMappings((rows) => [
                                    ...rows,
                                    { code: "", id: "", receiptId: "" },
                                  ])
                                }
                              >
                                Adicionar forma de pagamento ERP
                              </Button>
                            </>
                          )}
                          <div className="fiscal-actions">
                            <Button
                              variant="outline"
                              onClick={() =>
                                setItems((rows) => [...rows, emptyItem()])
                              }
                            >
                              Adicionar produto fiscal
                            </Button>
                            <Button
                              disabled={busy || !regime || !items.length}
                              onClick={() =>
                                run(
                                  () =>
                                    api.createFiscalProfile(
                                      buildFiscalProfile(
                                        provider,
                                        environment,
                                        profiles.supportedContract,
                                        operation,
                                        items,
                                        regime,
                                        {
                                          ...profiles.profile?.itemRules,
                                          ...(provider !== "focus"
                                            ? { policyVersion: policyName }
                                            : {}),
                                          ...(provider === "bling" ||
                                          provider === "tiny"
                                            ? {
                                                paymentMappings:
                                                  Object.fromEntries(
                                                    paymentMappings.map((m) => [
                                                      m.code,
                                                      {
                                                        code: m.code,
                                                        ...(provider === "bling"
                                                          ? { id: Number(m.id) }
                                                          : {
                                                              meioPagamentoId:
                                                                Number(m.id),
                                                              formaRecebimentoId:
                                                                Number(
                                                                  m.receiptId
                                                                ),
                                                            }),
                                                      },
                                                    ])
                                                  ),
                                              }
                                            : {}),
                                        }
                                      )
                                    ),
                                  "Rascunho fiscal salvo. Revise e confirme a versão."
                                )
                              }
                            >
                              Salvar perfil fiscal
                            </Button>
                          </div>
                          {profiles.profile &&
                            !profiles.profile.confirmedAt && (
                              <>
                                <label className="fiscal-check">
                                  <input
                                    type="checkbox"
                                    checked={confirmProfile}
                                    onChange={(e) =>
                                      setConfirmProfile(e.target.checked)
                                    }
                                  />
                                  Revisei esta configuração como responsável
                                  pela empresa ou contabilidade.
                                </label>
                                <Button
                                  disabled={busy || !confirmProfile}
                                  onClick={() =>
                                    run(
                                      () =>
                                        api.confirmFiscalProfile(
                                          profiles.profile!.id,
                                          environment
                                        ),
                                      "Perfil fiscal confirmado com autor e instante registrados."
                                    )
                                  }
                                >
                                  Confirmar perfil fiscal
                                </Button>
                              </>
                            )}
                        </>
                      )}
                    </section>
                    {selectedConnection && (
                      <>
                        {provider !== "focus" && (
                          <section className="fiscal-section configuration-form">
                            <h2>Efeitos da configuração no ERP</h2>
                            <p>
                              Confirme as configurações existentes na conta
                              dedicada. Estes dados não autenticam o certificado
                              nem alteram o painel do ERP.
                            </p>
                            {setup?.accountEvidence && (
                              <p>
                                Confirmação registrada em{" "}
                                {new Date(
                                  setup.accountEvidence.confirmedAt
                                ).toLocaleString("pt-BR")}
                                .
                              </p>
                            )}
                            <div className="configuration-form__grid">
                              <p>
                                Revisão do perfil confirmado:{" "}
                                {String(
                                  profiles?.confirmedProfile?.itemRules
                                    .policyVersion ?? "Confirmação pendente"
                                )}
                              </p>
                              <FormField
                                label="Revisar esta confirmação até"
                                type="date"
                                value={expires}
                                onChange={setExpires}
                              />
                              <FormField
                                label="Certificado válido até"
                                type="date"
                                value={certificateExpiry}
                                onChange={setCertificateExpiry}
                              />
                            </div>
                            {Object.keys(effects).map((key) => (
                              <label key={key} className="fiscal-check">
                                <input
                                  type="checkbox"
                                  checked={effects[key]}
                                  onChange={(e) =>
                                    setEffects((v) => ({
                                      ...v,
                                      [key]: e.target.checked,
                                    }))
                                  }
                                />
                                {
                                  (
                                    {
                                      stockOnSave:
                                        "Baixa estoque ao salvar pedido",
                                      stockOnAuthorize:
                                        "Baixa estoque ao autorizar nota",
                                      stockOnCancel:
                                        "Estorna estoque ao cancelar nota",
                                      accountsOnSave:
                                        "Gera financeiro ao salvar pedido",
                                      accountsOnAuthorize:
                                        "Gera financeiro ao autorizar nota",
                                      accountsOnCancel:
                                        "Estorna financeiro ao cancelar nota",
                                      automaticEmail:
                                        "ERP envia e-mail automaticamente",
                                      automaticInvoiceGeneration:
                                        "ERP gera nota automaticamente",
                                      automaticInvoiceAuthorization:
                                        "ERP autoriza nota automaticamente",
                                    } as Record<string, string>
                                  )[key]
                                }
                              </label>
                            ))}
                            <label className="fiscal-check">
                              <input
                                type="checkbox"
                                checked={accountConfirmed}
                                onChange={(e) =>
                                  setAccountConfirmed(e.target.checked)
                                }
                              />
                              Conferi estes efeitos no painel do ERP com o
                              responsável fiscal.
                            </label>
                            <Button
                              disabled={
                                busy ||
                                !accountConfirmed ||
                                !profiles?.confirmedProfile ||
                                !profiles?.confirmedProfile?.itemRules
                                  .policyVersion ||
                                profiles.profile?.id !==
                                  profiles.confirmedProfile.id ||
                                policyName !==
                                  profiles.confirmedProfile.itemRules
                                    .policyVersion ||
                                !expires ||
                                !certificateExpiry
                              }
                              onClick={() =>
                                run(
                                  () =>
                                    api.saveFiscalSetup(selectedConnection.id, {
                                      environment,
                                      accountConfiguration: {
                                        profileVersionId:
                                          profiles!.confirmedProfile!.id,
                                        policyVersion: String(
                                          profiles!.confirmedProfile!.itemRules
                                            .policyVersion
                                        ),
                                        confirmed: true,
                                        expiresAt: new Date(
                                          expires + "T23:59:59Z"
                                        ).toISOString(),
                                        certificateValidUntil: new Date(
                                          certificateExpiry + "T23:59:59Z"
                                        ).toISOString(),
                                        effects:
                                          effects as unknown as NonNullable<
                                            Parameters<
                                              typeof api.saveFiscalSetup
                                            >[1]["accountConfiguration"]
                                          >["effects"],
                                      },
                                    }),
                                  "Configuração do ERP salva. Verifique a preparação para confirmar a conta com o emissor."
                                )
                              }
                            >
                              Confirmar configuração ERP
                            </Button>
                          </section>
                        )}
                        <section className="fiscal-section configuration-form">
                          <h2>Classificação fiscal do pagamento</h2>
                          <p>
                            Selecione um pagamento original da loja ou da nota.
                            O comprovante financeiro é consultado no provedor e
                            não pode ser editado aqui.
                          </p>
                          {!sources.length ? (
                            <p>
                              Nenhum pagamento original disponível neste
                              ambiente.
                            </p>
                          ) : (
                            <>
                              <div className="configuration-form__grid">
                                <FormSelect
                                  label="Pagamento de referência"
                                  value={sourceIndex}
                                  onChange={setSourceIndex}
                                  options={[
                                    {
                                      value: "",
                                      label: "Selecione o pagamento",
                                    },
                                    ...sources.map((s, i) => ({
                                      value: String(i),
                                      label: fiscalPaymentSourceLabel(s),
                                    })),
                                  ]}
                                />
                                <FormSelect
                                  label="Ambiente da conta de pagamento"
                                  value={paymentEnvironment}
                                  onChange={setPaymentEnvironment}
                                  options={[
                                    { value: "test", label: "Teste" },
                                    { value: "live", label: "Produção" },
                                    {
                                      value: "testnet",
                                      label: "Rede de teste cripto",
                                    },
                                    {
                                      value: "mainnet",
                                      label: "Rede principal cripto",
                                    },
                                  ]}
                                />
                                <FormField
                                  label="CNPJ da credenciadora (quando exigido)"
                                  value={acquirer}
                                  onChange={setAcquirer}
                                />
                                <FormField
                                  label="Fuso horário do pagamento (quando exigido)"
                                  value={paymentZone}
                                  onChange={setPaymentZone}
                                />
                                <FormField
                                  label="Descrição fiscal de cripto (quando aplicável)"
                                  value={cryptoDescription}
                                  onChange={setCryptoDescription}
                                />
                              </div>
                              <label className="fiscal-check">
                                <input
                                  type="checkbox"
                                  checked={confirmPayment}
                                  onChange={(e) =>
                                    setConfirmPayment(e.target.checked)
                                  }
                                />
                                Conferi a classificação da conta de pagamento.
                              </label>
                              <Button
                                disabled={
                                  busy || !confirmPayment || sourceIndex === ""
                                }
                                onClick={() =>
                                  run(() => {
                                    const s = sources[Number(sourceIndex)];
                                    return api.saveFiscalSetup(
                                      selectedConnection.id,
                                      {
                                        environment,
                                        paymentConfiguration: {
                                          ...(s.intentId
                                            ? { intentId: s.intentId }
                                            : {
                                                paymentIntentId:
                                                  s.paymentIntentId!,
                                              }),
                                          environment:
                                            paymentEnvironment as "test",
                                          confirmed: true,
                                          ...(acquirer
                                            ? { acquirerTaxId: acquirer }
                                            : {}),
                                          ...(paymentZone
                                            ? { providerTimeZone: paymentZone }
                                            : {}),
                                          ...(cryptoDescription
                                            ? { cryptoDescription }
                                            : {}),
                                        },
                                      }
                                    );
                                  }, "Forma de pagamento salva. Se faltarem dados do pagamento, a emissão continuará pendente.")
                                }
                              >
                                Salvar classificação do pagamento
                              </Button>
                            </>
                          )}
                          {setup?.paymentConfigurations.map((p, i) => (
                            <p key={i}>
                              {p.provider} · {p.environment} · confirmação{" "}
                              {new Date(p.confirmedAt).toLocaleDateString(
                                "pt-BR"
                              )}
                            </p>
                          ))}
                        </section>
                      </>
                    )}
                    {templates && (
                      <section className="fiscal-section configuration-form">
                        <h2>Entrega da nota fiscal</h2>
                        <p>
                          A nota permanece disponível no pedido mesmo se um
                          canal estiver bloqueado. WhatsApp exige autorização
                          transacional e modelo aprovado.
                        </p>
                        <div className="configuration-form__grid">
                          <FormField
                            label="Assunto do e-mail fiscal"
                            value={emailSubject}
                            onChange={setEmailSubject}
                          />
                          <FormTextarea
                            label="Mensagem do e-mail fiscal"
                            value={emailBody}
                            onChange={setEmailBody}
                          />
                        </div>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                api.saveFiscalTemplate("email", {
                                  subject: emailSubject,
                                  body: emailBody,
                                  revision: 0,
                                }),
                              "Modelo de e-mail fiscal salvo."
                            )
                          }
                        >
                          Salvar e-mail fiscal
                        </Button>
                        <FormTextarea
                          label="Modelo fiscal do WhatsApp"
                          value={whatsappBody}
                          onChange={setWhatsappBody}
                        />
                        <p>
                          Status WhatsApp: {templates.whatsapp.status}.{" "}
                          {templates.whatsapp.rejectionReason ?? ""}
                          {!templates.whatsappConnected
                            ? " Conecte o WhatsApp para enviar o modelo à aprovação."
                            : ""}
                        </p>
                        <div className="fiscal-actions">
                          <Button
                            disabled={busy}
                            onClick={() =>
                              run(
                                () =>
                                  api.saveFiscalTemplate("whatsapp", {
                                    body: whatsappBody,
                                    revision: templates.whatsapp.revision,
                                  }),
                                "Rascunho WhatsApp salvo. O envio depende de aprovação externa."
                              )
                            }
                          >
                            Salvar modelo WhatsApp
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy || !templates.whatsappConnected}
                            onClick={() =>
                              run(
                                () => api.submitFiscalWhatsAppTemplate(),
                                "Solicitação de aprovação enviada. Aguarde o resultado da Meta."
                              )
                            }
                          >
                            Enviar modelo para aprovação
                          </Button>
                        </div>
                      </section>
                    )}
                  </>
                )}
            </>
          )}
          <ConfirmDialog
            open={disconnect}
            title="Desconectar emissor fiscal?"
            description="As notas e os documentos existentes serão preservados. Novas emissões dependerão de uma conexão pronta."
            confirmLabel="Desconectar emissor"
            busy={busy}
            error={error}
            onCancel={() => setDisconnect(false)}
            onConfirm={() => {
              if (selectedConnection)
                void run(
                  () =>
                    api.disconnectFiscalConnection(
                      selectedConnection.id,
                      environment
                    ),
                  "Emissor desconectado. Documentos anteriores preservados."
                ).then((ok) => {
                  if (ok) setDisconnect(false);
                });
            }}
          />
        </>
      )}
    </div>
  );
}
