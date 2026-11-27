import { CampaignAudienceMetrics, CampaignDeliveryMetrics } from "./CampaignMetrics.js";
import React, { useState } from "react";
import { Megaphone, ArrowLeft } from "lucide-react";
import { Button } from "../../components/Button.js";
import { PageLoader } from "../../components/PageLoader.js";
import { MarketingEmptyState } from "./MarketingEmptyState.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { CampaignEditor } from "./CampaignEditor.js";
import { MarketingBillingNotice } from "./MarketingBillingNotice.js";
import { useMarketingCampaigns } from "./useMarketingCampaigns.js";
import { marketingMoney, marketingDate } from "./marketing-format.js";
import type { MarketingCampaign } from "../../api/marketing.js";

const campaignLabels: Record<MarketingCampaign["status"], string> = {
  draft: "Rascunho",
  approved: "Aprovada pelo lojista",
  scheduled: "Agendada",
  running: "Em envio",
  paused: "Pausada",
  completed: "Finalizada",
};
const templateLabels: Record<string, string> = {
  not_submitted: "Ainda não enviado à Meta",
  approved: "Aprovado pela Meta",
  pending: "Em análise pela Meta",
  rejected: "Recusado pela Meta",
  submitting: "Submissão em andamento",
  submission_unknown: "Submissão a conferir",
  unavailable: "Aprovação não confirmada",
  connection_unavailable: "Conexão WhatsApp indisponível",
  connection_changed: "Conexão WhatsApp alterada",
};
const exclusions: Record<string, string> = {
  no_phone: "Sem telefone identificado",
  no_consent: "Sem autorização comprovada",
  preference_blocked: "Recebimento desativado nas preferências",
};
const outcomeLabels: Record<string, string> = {
  queued: "Na fila",
  sending: "Em processamento",
  accepted: "Aceitas pelo provedor",
  delivered: "Entregues",
  read: "Lidas",
  failed: "Falhas",
  suppressed: "Não enviadas",
  unknown: "Resultado incerto",
};

export function CampaignsPanel({
  apiBaseUrl,
  onSettings,
}: {
  apiBaseUrl: string;
  onSettings: () => void;
}) {
  const vm = useMarketingCampaigns(apiBaseUrl);
  const [confirm, setConfirm] = useState<"approve" | "send" | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const c = vm.campaign;
  const approved =
    !!c &&
    c.approvedVersion === c.version &&
    ["approved", "paused"].includes(c.status);
  const editable =
    !!c &&
    ["draft", "approved", "scheduled", "paused"].includes(c.status) &&
    !Object.entries(vm.report?.counts ?? {}).some(
      ([key, count]) => key !== "queued" && count > 0
    );
  const approveReady =
    !!c &&
    c.status === "draft" &&
    c.templateStatus === "approved" &&
    vm.review?.settingsConfigured &&
    vm.review.budgetSufficient &&
    vm.review.eligible > 0;
  const confirmed = async () => {
    if (!c) return;
    const result = await vm.run(
      () =>
        confirm === "approve"
          ? vm.api.approve(c.id, c.version)
          : vm.api.schedule(c.id),
      confirm === "approve"
        ? "Campanha aprovada. O público desta versão foi congelado."
        : "Campanha liberada. Os envios seguem os horários e limites da loja."
    );
    if (result) setConfirm(null);
  };
  const schedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!c || !scheduledAt) return;
    const parsed = new Date(scheduledAt);
    if (!Number.isFinite(parsed.getTime())) return;
    await vm.run(
      () => vm.api.schedule(c.id, parsed.toISOString()),
      "Campanha agendada."
    );
  };
  return (
    <section className="marketing-campaigns">
      {vm.error && !vm.editing && (
        <div role="alert" className="marketing-notice">
          {vm.error}
          <Button variant="outline" onClick={vm.refresh}>
            Atualizar dados
          </Button>
        </div>
      )}
      {vm.notice && (
        <p role="status" className="marketing-notice">
          {vm.notice}
        </p>
      )}
      {vm.editing && (
        <CampaignEditor
          key={c ? `${c.id}:${c.version}` : "new"}
          campaign={c ?? undefined}
          busy={vm.busy}
          saveError={vm.error}
          onSave={vm.save}
          onCancel={() => vm.setEditing(false)}
        />
      )}
      {vm.selected ? (
        <>
          <Button variant="ghost" disabled={vm.busy} onClick={vm.back}>
            <ArrowLeft size={16} aria-hidden="true" /> Voltar às campanhas
          </Button>
          {!c ? (
            !vm.error && <PageLoader variant="section" />
          ) : (
            <>
              <header className="marketing-section">
                <h2>{c.name}</h2>
                <p>
                  {campaignLabels[c.status]} · Versão {c.version}
                  {c.scheduledAt ? ` · ${marketingDate(c.scheduledAt)}` : ""}
                </p>
                <div className="marketing-actions">
                  <Button
                    variant="outline"
                    disabled={!editable || vm.busy}
                    onClick={() => vm.setEditing(true)}
                  >
                    Editar rascunho
                  </Button>
                  <Button
                    variant="outline"
                    disabled={vm.busy}
                    onClick={vm.refresh}
                  >
                    Atualizar resultados
                  </Button>
                  {["approved", "scheduled", "running"].includes(c.status) && (
                    <Button
                      variant="outline"
                      loading={vm.busy}
                      onClick={() =>
                        void vm.run(
                          () => vm.api.pause(c.id),
                          "Campanha pausada. Novos envios foram interrompidos."
                        )
                      }
                    >
                      Pausar campanha
                    </Button>
                  )}
                </div>
              </header>
              <MarketingBillingNotice />
              <section className="marketing-section">
                <h3>Mensagem da campanha</h3>
                <blockquote className="marketing-preview">{c.body}</blockquote>
                <p>
                  Orçamento estimado: {marketingMoney(c.budgetCents)} · Reserva
                  por mensagem: {marketingMoney(c.maxUnitCostCents)}
                </p>
                <p className="marketing-help">
                  A reserva é uma estimativa para controlar os envios. O valor
                  efetivamente cobrado depende das tarifas da Meta.
                </p>
              </section>
              <section className="marketing-section">
                <h3>Aprovação do template</h3>
                <p>
                  {templateLabels[c.templateStatus] ??
                    "Verifique a situação do template na Meta."}
                </p>
                <div className="marketing-actions">
                  {!c.templateName ? (
                    <Button
                      variant="outline"
                      loading={vm.busy}
                      onClick={() =>
                        void vm.run(
                          () => vm.api.submitTemplate(c.id),
                          "Solicitação processada. Confira a situação do template antes de aprovar os envios."
                        )
                      }
                    >
                      Enviar template para aprovação
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      loading={vm.busy}
                      onClick={() =>
                        void vm.run(
                          () => vm.api.syncTemplate(c.id),
                          "Situação do template atualizada."
                        )
                      }
                    >
                      Verificar aprovação na Meta
                    </Button>
                  )}
                </div>
                <p className="marketing-help">
                  A avaliação da Meta não envia mensagens aos seus contatos. A
                  aprovação do lojista é uma etapa separada.
                </p>
              </section>
              {vm.review && (
                <section className="marketing-section">
                  <h3>Revisão do público</h3>
                  <CampaignAudienceMetrics review={vm.review} />
                  {Object.entries(vm.review.excluded).map(([reason, count]) => (
                    <p key={reason}>
                      {exclusions[reason] ?? "Outras restrições"}: {count}
                    </p>
                  ))}
                  {!vm.review.settingsConfigured && (
                    <p className="marketing-notice">
                      Configure os controles da loja antes de aprovar.
                      <Button variant="outline" onClick={onSettings}>
                        Abrir configurações
                      </Button>
                    </p>
                  )}
                  <p className="marketing-help">
                    A aprovação congela os destinatários desta versão.
                    Autorização, telefone, frequência e limites são verificados
                    novamente antes de cada envio.
                  </p>
                  {c.status === "draft" && (
                    <Button
                      disabled={!approveReady || vm.busy}
                      onClick={() => setConfirm("approve")}
                    >
                      Revisar e aprovar campanha
                    </Button>
                  )}
                </section>
              )}
              {approved && (
                <section className="marketing-section">
                  <h3>Programar envios</h3>
                  <p>
                    Os envios respeitam o período e a frequência configurados
                    pela loja.
                  </p>
                  <Button disabled={vm.busy} onClick={() => setConfirm("send")}>
                    Liberar envio agora
                  </Button>
                  <form
                    className="marketing-form marketing-schedule"
                    onSubmit={schedule}
                  >
                    <label>
                      Agendar no seu fuso (
                      {Intl.DateTimeFormat().resolvedOptions().timeZone})
                      <input
                        required
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(event) => setScheduledAt(event.target.value)}
                      />
                    </label>
                    <Button type="submit" variant="outline" loading={vm.busy}>
                      Agendar campanha
                    </Button>
                  </form>
                </section>
              )}
              {c.approvedVersion && vm.report && (
                <section className="marketing-section">
                  <h3>Resultados do público aprovado</h3>
                  <CampaignDeliveryMetrics report={vm.report} labels={outcomeLabels} />
                  <p className="marketing-help">
                    Aceite do provedor, entrega e leitura são situações
                    diferentes. Os números mostram a situação atual de cada
                    destinatário.
                  </p>
                  {vm.report.counts.unknown > 0 && (
                    <p className="marketing-notice">
                      Há envios com resultado incerto. Essas tentativas não
                      serão repetidas automaticamente.
                    </p>
                  )}
                  {vm.report.attributedRevenueCents === null ? (
                    <p className="marketing-help">
                      Receita atribuída indisponível: não há vínculo comprovado
                      entre esta campanha e uma compra.
                    </p>
                  ) : (
                    <p>
                      Receita atribuída:{" "}
                      {marketingMoney(vm.report.attributedRevenueCents)}
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <header className="marketing-section-heading marketing-campaign-heading">
            <div>
              <h2>Campanhas pelo WhatsApp</h2>
              <p>
                Crie novidades, comunicações e promoções para contatos que
                autorizaram o recebimento.
              </p>
            </div>
            <Button onClick={vm.create}>Criar campanha</Button>
          </header>
          <MarketingBillingNotice />
          {vm.loading ? (
            <PageLoader variant="section" />
          ) : !vm.list.length ? (
            <MarketingEmptyState
              icon={Megaphone}
              title="Sua primeira campanha começa aqui"
              description="Defina a mensagem e o público. Revise a autorização e aprove antes de liberar os envios."
            />
          ) : (
            <div className="marketing-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Situação</th>
                    <th>Última atualização</th>
                    <th>
                      <span className="sr-only">Abrir</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vm.list.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td>{campaignLabels[item.status]}</td>
                      <td>{marketingDate(item.updatedAt)}</td>
                      <td>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => vm.open(item.id)}
                        >
                          Ver campanha
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "approve"
            ? "Aprovar esta campanha?"
            : "Liberar os envios?"
        }
        variant="default"
        busy={vm.busy}
        error={vm.error}
        confirmLabel={
          confirm === "approve" ? "Aprovar campanha" : "Iniciar envios"
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => void confirmed()}
        description={
          confirm === "approve"
            ? `${
                vm.review?.eligible ?? 0
              } contatos elegíveis. Reserva prevista: ${marketingMoney(
                vm.review?.estimatedReservationCents ?? 0
              )}. O público será congelado na aprovação. Nenhuma mensagem será enviada nesta etapa.`
            : `A campanha poderá iniciar no próximo período permitido. Os envios seguem o público aprovado e os limites da loja. Mensagens já aceitas pelo provedor não podem ser desfeitas.`
        }
      />
    </section>
  );
}
