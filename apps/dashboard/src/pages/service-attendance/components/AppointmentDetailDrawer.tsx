import React, { useId } from "react";
import { Button } from "../../../components/Button.js";
import { FormField, FormSelect } from "../../../components/FormField.js";
import { Modal } from "../../../components/Modal.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { formatAvailabilityInstant } from "./availability-form.js";
import { useAppointmentDetail, type AppointmentDetailProps } from "./useAppointmentDetail.js";
import "./appointment-detail.css";
const operational = { pending: "Pendente", scheduled: "Agendado", in_service: "Em atendimento", completed: "Concluído", no_show: "Não compareceu", cancelled: "Cancelado" } as const;
const actions = { start_service: "Iniciar atendimento", complete_service: "Concluir atendimento", no_show: "Registrar ausência" } as const;
const money = (cents: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
const empty = (label: string) => ({ value: "", label });

export function AppointmentDetailDrawer(props: AppointmentDetailProps) {
  const form = useAppointmentDetail(props), acceptId = useId(), close = () => props.onClose?.();
  if (!props.open) return null;
  if (form.status === "unauthorized") return <Modal isOpen title="Sessão expirada" onClose={close}><p>Entre novamente para acessar os dados do atendimento. Confira o resultado de operações anteriores antes de criar outra tentativa.</p></Modal>;
  if (!form.allowed) return null;
  const detail = form.detail, summary = form.summary, d = form.draft, quote = form.preview?.quote, policies = form.policies;
  const balance = summary?.localPayments.find(row => row.paymentId === d.paymentId), locked = form.locked;
  const pending = form.status === "submitting" || form.status === "loading";
  return <Modal isOpen title="Detalhes do agendamento" eyebrow="Atendimento" subtitle="Acompanhe o serviço e os registros financeiros, cada um com sua situação." size="lg" onClose={close}
    footer={<><Button variant="outline" onClick={close}>Fechar</Button>
      {form.status === "uncertain" && <Button onClick={() => void form.retry()}>Repetir mesma operação</Button>}
      {["error", "rejected", "detail_error"].includes(form.status) && <Button onClick={() => void form.reload()}>Recarregar detalhes</Button>}
      {pending && <Button disabled>{form.status === "submitting" ? "Enviando operação…" : "Conferindo dados…"}</Button>}
      {form.status === "ready" && form.mode !== "detail" && <Button variant="outline" onClick={form.back}>Sair da ação</Button>}
      {form.status === "ready" && form.mode === "cancel" && <Button variant="danger" disabled={!d.accepted || !policies || form.reading} onClick={() => void form.cancel()}>Confirmar cancelamento</Button>}
      {form.status === "ready" && form.mode === "reschedule" && <Button disabled={!d.accepted || !form.preview || form.preview.requiresSeparateFinancialReview || form.reading} onClick={() => void form.reschedule()}>Confirmar remarcação</Button>}
      {form.status === "ready" && form.mode === "receipt" && <Button disabled={!d.accepted || !balance?.canRecordReceipt || !d.paymentMethod.trim()} onClick={() => void form.receipt()}>Confirmar recebimento</Button>}</>}>
    <div className="appointment-detail">
      {form.error && <p className="appointment-detail__notice" role="alert">{form.error}</p>}
      {form.status === "loading" && <p role="status">Conferindo os dados atuais…</p>}
      {detail && <>
        <section className="appointment-detail__identity"><span>{detail.customer.name ?? "Cliente sem nome informado"}</span><h3>{detail.serviceName}</h3>
          <dl><div><dt>Atendimento</dt><dd>{operational[detail.operationalStatus]}</dd></div><div><dt>Profissional</dt><dd>{detail.professionalName}</dd></div>
            <div><dt>Horário</dt><dd>{formatAvailabilityInstant(detail.startsAt, detail.timeZone)}<small>{detail.timeZone === "America/Sao_Paulo" ? "Horário de Brasília" : `Fuso registrado: ${detail.timeZone}`}</small></dd></div>
            <div><dt>Duração</dt><dd>{detail.durationMinutes} minutos</dd></div><div><dt>Valor do serviço</dt><dd>{money(detail.priceInCents, detail.currency)}</dd></div></dl>
          {(detail.customer.phone || detail.customer.email) && <p className="appointment-detail__muted">{[detail.customer.phone, detail.customer.email].filter(Boolean).join(" · ")}</p>}
          {form.status !== "ready" && <p className="appointment-detail__muted">Os dados exibidos são da última leitura. Aguarde a conferência atual para realizar outra ação.</p>}
        </section>
        <section className="appointment-detail__section" aria-label="Registros financeiros"><h3>Pagamento</h3><p className="appointment-detail__muted">A situação do atendimento não confirma nem altera o pagamento.</p>
          {!detail.payments.length ? <p>Sem registro de pagamento</p> : <ul className="appointment-detail__payments">{detail.payments.map(payment => {
            const current = summary?.localPayments.find(row => row.paymentId === payment.id);
            return <li key={payment.id}><div><strong>{payment.status === "approved" ? "Pagamento recebido" : payment.status === "pending" ? payment.mode === "at_attendance" ? "A pagar no atendimento" : "Aguardando pagamento online" : payment.status === "failed" ? "Pagamento não concluído" : payment.status === "cancelled" ? "Pagamento cancelado" : payment.status === "refunded" ? "Pagamento reembolsado" : "Pagamento parcialmente reembolsado"}</strong><span>{money(payment.amountCents, payment.currency)}</span></div>
              {payment.requiresRegularization && <p>Este registro requer regularização financeira.</p>}
              {current?.balanceStatus === "available" && <p>Saldo a quitar: <strong>{money(current.remainingCents!, current.currency)}</strong> · recebido anteriormente: {money(current.receivedCents!, current.currency)}</p>}
              {current?.balanceStatus === "unavailable" && <p>O saldo não pôde ser confirmado. Confira os registros antes de receber.</p>}
              {form.status === "ready" && form.mode === "detail" && current?.canRecordReceipt && <Button variant="outline" onClick={() => form.openReceipt(payment.id)}>Registrar recebimento</Button>}
            </li>;
          })}</ul>}
        </section>
        {form.status === "ready" && form.mode === "detail" && summary && <section className="appointment-detail__actions" aria-label="Ações disponíveis">{summary.attendanceActions.map(action => <Button key={action} onClick={() => void form.transition(action)}>{actions[action]}</Button>)}
          {summary.canReviewRescheduling && <Button variant="outline" onClick={() => void form.openReschedule()}>Remarcar</Button>}
          {summary.canReviewCancellation && <Button variant="outline" onClick={() => void form.openCancellation()}>Cancelar agendamento</Button>}</section>}
        {(form.mode === "cancel" || form.mode === "reschedule") && <section className="appointment-detail__section"><h3>Políticas atuais</h3>{form.reading && !policies && <p role="status">Consultando as políticas…</p>}
          {policies?.policies.map(policy => <article key={policy.sourceId} className="appointment-detail__policy"><small>{policy.sourceId} · versão {policy.sourceVersion}</small><p>{policy.text ?? "Esta política não está publicada. A ausência de texto não autoriza condições adicionais."}</p></article>)}
          {policies && !policies.policies.length && <p>Nenhuma política pública disponível nesta leitura.</p>}
          {policies && <details className="appointment-detail__reference"><summary>Referência das políticas consultadas</summary><code>{policies.hash}</code></details>}
          <p className="appointment-detail__muted">Cancelar ou remarcar não realiza estorno nem confirma recebimento. Qualquer análise financeira permanece separada.</p>
          {form.mode === "cancel" && policies && <div className="appointment-detail__accept"><label htmlFor={acceptId}>Li as políticas e solicito o cancelamento</label><ToggleSwitch id={acceptId} checked={d.accepted} disabled={locked} onChange={accepted => form.update({ accepted })} /></div>}
        </section>}
        {form.mode === "reschedule" && <fieldset disabled={locked} className="appointment-detail__section"><legend>Escolher novo horário</legend>
          <FormSelect label="Novo profissional" value={d.professionalId} onChange={professionalId => form.update({ professionalId })} disabled={locked} options={[empty("Selecione um profissional vinculado"), ...form.professionals.map(row => ({ value: row.id, label: row.publicName }))]} />
          {form.professionalHasMore && <Button variant="outline" disabled={locked} onClick={() => void form.loadMoreProfessionals()}>Carregar mais profissionais</Button>}
          <div className="appointment-detail__grid"><FormField label="Consultar de" type="date" value={d.fromDate} onChange={fromDate => form.update({ fromDate })} disabled={locked} /><FormField label="Consultar até" type="date" value={d.toDate} onChange={toDate => form.update({ toDate })} disabled={locked} /></div>
          <Button variant="outline" disabled={locked || form.reading || !d.professionalId || !policies} onClick={() => void form.loadDates()}>Consultar novas datas</Button>
          <p className="appointment-detail__muted">Novos horários em Brasília. A disponibilidade será conferida pelo sistema.</p>
          <FormSelect label="Nova data" value={d.date} onChange={value => void form.selectDate(value)} disabled={locked || form.reading || form.dates?.status !== "ready"} options={[empty("Selecione uma data consultada"), ...(form.dates?.dates ?? []).map(value => ({ value, label: value.split("-").reverse().join("/") }))]} />
          <FormSelect label="Novo horário" value={d.startsAt} onChange={startsAt => form.update({ startsAt })} disabled={locked || form.reading || form.slots?.status !== "ready"} options={[empty("Selecione um horário consultado"), ...(form.slots?.slots ?? []).map(row => ({ value: row.startsAt, label: row.startTime }))]} />
          <Button variant="outline" disabled={locked || form.reading || !d.startsAt || !policies} onClick={() => void form.previewQuote()}>Conferir remarcação</Button>
          {form.dates?.status === "empty" && <p>Nenhuma data disponível no período.</p>}{form.slots?.status === "empty" && <p>Nenhum horário disponível nesta data.</p>}
          {quote && <section className="appointment-detail__quote"><h3>Condições da remarcação</h3><dl><div><dt>Profissional</dt><dd>{form.professionals.find(row => row.id === quote.professionalId)?.publicName ?? "Profissional selecionado"}</dd></div><div><dt>Novo horário</dt><dd>{formatAvailabilityInstant(quote.startsAt, quote.timeZone)} · Brasília</dd></div><div><dt>Duração</dt><dd>{quote.durationMinutes} minutos</dd></div><div><dt>Valor do serviço</dt><dd>{money(quote.priceInCents, quote.currency)}</dd></div><div><dt>Pagamento</dt><dd>{quote.paymentMode === "online" ? "Online" : "No atendimento"}</dd></div><div><dt>Bloqueio temporário</dt><dd>{quote.holdEnabled ? `${quote.holdMinutes} minutos` : "Desativado"}</dd></div></dl>
            <small>Política de agendamento v{quote.policyVersion}.</small><details className="appointment-detail__reference"><summary>Referência das condições apresentadas</summary><code>{form.preview?.quoteHash}</code></details>
            {form.preview?.requiresSeparateFinancialReview ? <p role="alert">Esta alteração exige análise financeira separada. A remarcação não será confirmada por esta tela.</p> : <div className="appointment-detail__accept"><label htmlFor={acceptId}>Concordo com estas condições</label><ToggleSwitch id={acceptId} checked={d.accepted} disabled={locked} onChange={accepted => form.update({ accepted })} /></div>}</section>}
        </fieldset>}
        {form.mode === "receipt" && <fieldset disabled={locked} className="appointment-detail__section"><legend>Quitar saldo no atendimento</legend><p>Registre somente um valor que foi efetivamente recebido. Esta ação não cobra o cliente por um provedor.</p>
          {balance?.remainingCents !== null && balance && <p>Quitação integral: <output>{money(balance.remainingCents!, balance.currency)}</output></p>}
          <FormField label="Forma de recebimento" value={d.paymentMethod} onChange={paymentMethod => form.update({ paymentMethod })} disabled={locked} maxLength={64} placeholder="Ex.: Pix presencial, dinheiro, cartão presencial" />
          <div className="appointment-detail__accept"><label htmlFor={acceptId}>Confirmo a quitação integral do saldo</label><ToggleSwitch id={acceptId} checked={d.accepted} disabled={locked} onChange={accepted => form.update({ accepted })} /></div>
        </fieldset>}
        {form.readError && <p role="alert" className="appointment-detail__notice">{form.readError}</p>}
        <section className="appointment-detail__section"><h3>Histórico do atendimento</h3>{!detail.history.length ? <p className="appointment-detail__muted">Nenhum evento disponível nesta leitura.</p> : <ol className="appointment-detail__history">{detail.history.map(event => <li key={event.id}><strong>{({ create: "Agendamento criado", start_service: "Atendimento iniciado", complete_service: "Atendimento concluído", no_show: "Ausência registrada", cancel: "Agendamento cancelado", reschedule: "Horário alterado", attendance_receipt: "Recebimento no atendimento" } as Record<string, string>)[event.action] ?? event.action}</strong><time dateTime={event.occurredAt}>{formatAvailabilityInstant(event.occurredAt, "America/Sao_Paulo")} · Brasília</time></li>)}</ol>}
          {detail.historyPartial && <p className="appointment-detail__muted">Esta leitura mostra parte do histórico disponível.</p>}</section>
      </>}
    </div>
  </Modal>;
}
