import React, { useEffect, useMemo, useRef, useState } from "react";
import { createDashboardApi } from "../../api-client.js";
import type {
  FiscalEnvironment,
  FiscalInvoiceDetail as Detail,
  FiscalProfile,
  FiscalDocumentKind,
} from "../../api/fiscal.js";
import { PageHeader } from "../../components/PageHeader.js";
import { SetupGuide } from "../../components/SetupGuide.js";
import { Button } from "../../components/Button.js";
import { Modal } from "../../components/Modal.js";
import { FormTextarea } from "../../components/FormField.js";
import {
  fiscalErrorText,
  fiscalReasonText,
  providerLabels,
} from "./fiscal-ui.js";
import {
  fiscalStateLabels,
  fiscalDeliveryLabels,
} from "./FiscalInvoicesPage.js";
import "../../components/configuration-form.css";
import "./fiscal.css";
export const validCancellation = (justification: string, confirmed: boolean) =>
  confirmed &&
  justification.trim().length >= 15 &&
  justification.trim().length <= 255 &&
  !/[\u0000-\u001f]/.test(justification);
const date = (value: string) => new Date(value).toLocaleString("pt-BR");
const historyLabels: Record<string, string> = {
  authorized: "Autorização confirmada",
  cancelled: "Cancelamento confirmado",
  reprocess_requested: "Reprocessamento solicitado",
  reconciliation_requested: "Consulta ao emissor solicitada",
  cancellation_requested: "Cancelamento solicitado",
  stock_barrier_released: "Atualização do estoque concluída",
  stock_effect_reconciled: "Baixa do estoque confirmada",
  profile_confirmed: "Perfil confirmado",
  document_authorized: "Autorização confirmada",
  provider_result: "Resultado do provedor",
};
export function FiscalInvoiceEvidence({ detail: d }: { detail: Detail }) {
  return (
    <>
      <section className="fiscal-section">
        <h2>Pedido {d.orderId}</h2>
        <p>
          {d.recipientName} · {providerLabels[d.provider]} ·{" "}
          {d.environment === "homologation"
            ? "Homologação · sem validade fiscal"
            : "Produção"}
        </p>
        <p>
          Estado fiscal: <strong>{fiscalStateLabels[d.state]}</strong>
        </p>
        <p>
          Total da venda:{" "}
          {new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: d.currency,
          }).format(d.totalCents / 100)}{" "}
          · {date(d.completedAt)}
        </p>
        {d.reasonCode && <p>{fiscalReasonText(d.reasonCode)}</p>}
        {d.document.number && (
          <p>
            Número: {d.document.number} · Série:{" "}
            {d.document.series ?? "Não informada"}
          </p>
        )}
        {d.document.accessKey && (
          <p>
            Chave de acesso: <code>{d.document.accessKey}</code>
          </p>
        )}
        {d.document.authorizationProtocol && (
          <p>
            Protocolo de autorização: {d.document.authorizationProtocol}
            {d.document.authorizedAt
              ? ` · ${date(d.document.authorizedAt)}`
              : ""}
          </p>
        )}
        {d.document.cancellationProtocol && (
          <p>
            Protocolo de cancelamento: {d.document.cancellationProtocol}
            {d.document.cancelledAt ? ` · ${date(d.document.cancelledAt)}` : ""}
          </p>
        )}
        {d.document.documentState === "document_pending" && (
          <p>
            {d.document.authorizationProtocol
              ? "Arquivos em recuperação. A autorização confirmada permanece preservada."
              : "A nota ainda aguarda autorização do emissor. Os arquivos ficarão disponíveis após a confirmação."}
          </p>
        )}
      </section>
      <section className="fiscal-section">
        <h2>Estoque e entregas</h2>
        <p>
          Estoque:{" "}
          {
            {
              managed_by_zyon: "Gerenciado pela Zyon",
              awaiting_provider_evidence:
                "Aguardando o emissor confirmar a baixa do estoque",
              evidence_confirmed:
                "Baixa confirmada pelo emissor; atualização na Zyon pendente",
              released: "Atualização do estoque concluída",
            }[d.stock.state]
          }
        </p>
        {d.deliveries.length ? (
          d.deliveries.map((v) => (
            <p key={v.channel}>
              {v.channel === "email" ? "E-mail" : "WhatsApp"}:{" "}
              {fiscalDeliveryLabels[v.state]}
              {v.safeReasonCode
                ? ` · ${fiscalReasonText(v.safeReasonCode)}`
                : ""}
            </p>
          ))
        ) : (
          <p>Sem entrega registrada.</p>
        )}
        {d.reviews.map((review) => (
          <p key={review.id}>
            Revisão fiscal:{" "}
            {review.reviewState === "cancelled"
              ? "Cancelamento confirmado"
              : review.reviewState === "pending"
              ? "Aguardando confirmação fiscal"
              : "Ação necessária"}
            {review.safeReasonCode
              ? ` · ${fiscalReasonText(review.safeReasonCode)}`
              : ""}
          </p>
        ))}
      </section>
      <section className="fiscal-section">
        <h2>Histórico fiscal</h2>
        {d.history.length ? (
          <ol>
            {d.history.map((event) => (
              <li key={event.id}>
                <p>
                  {date(event.occurredAt)} ·{" "}
                  {historyLabels[event.action] ?? "Atualização fiscal"}
                  {event.nextState && event.nextState in fiscalStateLabels
                    ? ` · ${
                        fiscalStateLabels[
                          event.nextState as keyof typeof fiscalStateLabels
                        ]
                      }`
                    : ""}
                  {event.safeReasonCode
                    ? ` · ${fiscalReasonText(event.safeReasonCode)}`
                    : ""}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>Nenhum evento disponível.</p>
        )}
      </section>
    </>
  );
}
export function FiscalInvoiceDetail({
  apiBaseUrl,
  merchantId,
  intentId,
  environment,
  onBack,
  onSettings,
}: {
  apiBaseUrl: string;
  merchantId: string | null;
  intentId: string;
  environment: FiscalEnvironment;
  onBack?: () => void;
  onSettings?: () => void;
}) {
  const api = useMemo(
    () => createDashboardApi({ baseUrl: apiBaseUrl }),
    [apiBaseUrl]
  );
  const [detail, setDetail] = useState<Detail | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [dialog, setDialog] = useState<"cancel" | "reprocess" | "erp" | null>(null),
    [justification, setJustification] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [profile, setProfile] = useState<FiscalProfile | null>(null),
    [profileLoading, setProfileLoading] = useState(false);
  const generation = useRef(0),
    urls = useRef(new Set<string>());
  useEffect(() => {
    const current = ++generation.current;
    setDetail(null);
    setLoading(true);
    setError("");
    setNotice("");
    setDialog(null);
    setConfirmed(false);
    setJustification("");
    if (!merchantId) {
      setLoading(false);
      return;
    }
    void api
      .getFiscalInvoice(intentId, environment)
      .then((value) => {
        if (current === generation.current) setDetail(value);
      })
      .catch((e) => {
        if (current === generation.current) setError(fiscalErrorText(e));
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [api, merchantId, intentId, environment, revision]);
  async function action(work: () => Promise<Detail>, message: string) {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await work();
      if (current === generation.current) {
        setDetail(value);
        setNotice(message);
        setDialog(null);
        return true;
      }
    } catch (e) {
      if (current === generation.current) setError(fiscalErrorText(e));
    } finally {
      setBusy(false);
    }
    return false;
  }
  async function download(kind: FiscalDocumentKind) {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.downloadFiscalDocument(
        intentId,
        environment,
        kind
      );
      if (current !== generation.current) return;
      const url = URL.createObjectURL(result.blob);
      urls.current.add(url);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 0);
    } catch (e) {
      if (current === generation.current) setError(fiscalErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function reprocess() {
    if (!detail) return;
    const current = generation.current;
    setDialog("reprocess");
    setProfile(null);
    setProfileLoading(true);
    setError("");
    try {
      const p = await api.getFiscalProfiles(environment, detail.provider);
      if (current === generation.current) setProfile(p.confirmedProfile);
    } catch (e) {
      if (current === generation.current) setError(fiscalErrorText(e));
    } finally {
      setProfileLoading(false);
    }
  }
  const cancellation = detail?.allowedActions.find(
    (a) => a.kind === "request_cancellation"
  );
  return (
    <div className="fiscal-page">
      <PageHeader
        title="Detalhe fiscal"
        description="Confira a nota deste pedido, os arquivos e o que ainda precisa ser resolvido."
        actions={
          onBack && (
            <Button variant="outline" onClick={onBack}>
              Voltar às notas
            </Button>
          )
        }
      />
      <SetupGuide
        title="Como entender esta nota"
        steps={[
          {
            title: "Confira o resultado da nota",
            description:
              "Veja o estado, o número e o protocolo. Se o emissor ainda não confirmou o resultado, use Consultar resultado fiscal quando essa ação estiver disponível.",
          },
          {
            title: "Confira arquivos, estoque e envios",
            description:
              "A autorização da nota, a atualização do estoque e o envio ao comprador são etapas separadas. Um envio pendente não desfaz uma nota autorizada. Baixe XML e DANFE quando estiverem disponíveis.",
          },
          {
            title: "Use a próxima ação disponível",
            description:
              "Corrija a configuração ou consulte o emissor conforme a pendência. Solicitar cancelamento exige sua confirmação; o reembolso da venda não cancela a nota automaticamente.",
          },
        ]}
      />
      {!merchantId ? (
        <p role="alert">Faça login para consultar esta nota.</p>
      ) : loading ? (
        <p role="status">Carregando detalhe fiscal…</p>
      ) : (
        <>
          {error && (
            <div role="alert" className="fiscal-state">
              <p>{error}</p>
              {!dialog && (
                <Button
                  variant="outline"
                  onClick={() => setRevision((v) => v + 1)}
                  disabled={busy}
                >
                  Tentar novamente
                </Button>
              )}
            </div>
          )}
          {notice && <p role="status">{notice}</p>}
          {detail && (
            <>
              <FiscalInvoiceEvidence detail={detail} />
              <section className="fiscal-section">
                <h2>Documentos privados</h2>
                <div className="fiscal-actions">
                  {detail.document.documents.map((file) => (
                    <Button
                      key={file.kind}
                      variant="outline"
                      disabled={busy || !file.available}
                      onClick={() => download(file.kind)}
                    >
                      Baixar {file.kind === "xml" ? "XML" : "DANFE"}
                      {file.available ? "" : " · pendente"}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setRevision((v) => v + 1)}
                  >
                    Atualizar arquivos
                  </Button>
                </div>
              </section>
              <section className="fiscal-section">
                <h2>Ações disponíveis</h2>
                {!detail.allowedActions.length && (
                  <p>Nenhuma ação fiscal permitida neste estado.</p>
                )}
                <div className="fiscal-actions">
                  {detail.allowedActions.map((a) => (
                    <Button
                      key={a.kind}
                      variant={
                        a.kind === "request_cancellation" ? "danger" : "outline"
                      }
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        if (a.kind === "configure" || a.kind === "reconnect")
                          onSettings?.();
                        else if (a.kind === "reconcile")
                          void action(
                            () =>
                              api.reconcileFiscalInvoice(intentId, environment),
                            "Consulta registrada. O estado exibido é o último resultado fiscal confirmado."
                          );
                        else if (a.kind === "reprocess") void reprocess();
                        else if (a.kind === "erp_panel") setDialog("erp");
                        else {
                          setJustification("");
                          setConfirmed(false);
                          setDialog("cancel");
                        }
                      }}
                    >
                      {a.kind === "configure"
                        ? "Corrigir configuração fiscal"
                        : a.kind === "reconnect"
                        ? "Reconectar emissor"
                        : a.kind === "reconcile"
                        ? "Consultar resultado fiscal"
                        : a.kind === "reprocess"
                        ? "Reprocessar"
                        : a.kind === "erp_panel"
                        ? "Cancelar no ERP"
                        : "Solicitar cancelamento fiscal"}
                    </Button>
                  ))}
                </div>
              </section>
            </>
          )}
          <Modal
            isOpen={!!dialog}
            title={
              dialog === "cancel"
                ? "Solicitar cancelamento fiscal"
                : dialog === "reprocess"
                ? "Reprocessar nota corrigida"
                : "Cancelar no ERP"
            }
            presentation="center"
            size="sm"
            onClose={() => {
              if (!busy) setDialog(null);
            }}
            footer={
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Voltar sem enviar
                </Button>
                {dialog === "cancel" && (
                  <Button
                    variant="danger"
                    disabled={
                      busy ||
                      !validCancellation(justification, confirmed) ||
                      !cancellation?.reviewId
                    }
                    onClick={() => {
                      void action(
                        () =>
                          api.requestFiscalCancellation(intentId, environment, {
                            reviewId: cancellation!.reviewId!,
                            confirmed: true,
                            justification: justification.trim(),
                          }),
                        "Solicitação de cancelamento registrada. Aguarde a confirmação fiscal do provedor."
                      );
                    }}
                  >
                    Confirmar solicitação
                  </Button>
                )}
                {dialog === "reprocess" && (
                  <Button
                    disabled={busy || profileLoading || !profile?.confirmedAt}
                    onClick={() => {
                      void action(
                        () =>
                          api.reprocessFiscalInvoice(
                            intentId,
                            environment,
                            profile!.id
                          ),
                        "Reprocessamento registrado. Aguarde o resultado fiscal."
                      );
                    }}
                  >
                    Confirmar reprocessamento
                  </Button>
                )}
              </>
            }
          >
            {dialog === "cancel" && (
              <div className="configuration-form">
                <p>
                  A solicitação depende da elegibilidade da nota e da
                  confirmação do provedor. O reembolso comercial não cancela a
                  NF-e.
                </p>
                <FormTextarea
                  label="Justificativa do cancelamento fiscal"
                  value={justification}
                  onChange={setJustification}
                  maxLength={255}
                  hint="Informe entre 15 e 255 caracteres."
                />
                <label className="fiscal-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Confirmo que desejo solicitar o cancelamento desta nota.
                </label>
              </div>
            )}
            {dialog === "reprocess" &&
              (profileLoading ? (
                <p role="status">Consultando perfil fiscal confirmado…</p>
              ) : profile ? (
                <p>
                  Revalidar com o perfil confirmado, versão {profile.version},
                  de {date(profile.confirmedAt!)}. A nota autorizada permanece
                  imutável.
                </p>
              ) : (
                <p>Confirme a configuração corrigida antes de reprocessar.</p>
              ))}
            {dialog === "erp" && (
              <p>
                Faça o cancelamento no painel do{" "}
                {detail ? providerLabels[detail.provider] : "ERP"}. Depois use
                “Consultar resultado fiscal”. A pendência permanece até existir
                confirmação de cancelamento da mesma nota.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
          </Modal>
        </>
      )}
    </div>
  );
}
