import React, { useId } from "react";
import { CalendarDays, Clock3, UserRound, WalletCards } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { FormField, FormSelect, FormTextarea } from "../../../components/FormField.js";
import { Modal } from "../../../components/Modal.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { useManualAppointment, type ManualAppointmentProps } from "./useManualAppointment.js";
import { formatAvailabilityInstant } from "./availability-form.js";
import "./manual-appointment.css";

const statuses = { pending: "Pendente", scheduled: "Agendado", in_service: "Em atendimento", completed: "Concluído", no_show: "Não compareceu", cancelled: "Cancelado" } as const;
const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
const choice = (label: string) => ({ value: "", label });

export function ManualAppointmentDrawer(props: ManualAppointmentProps) {
  const form = useManualAppointment(props), oneOffId = useId(), wallId = useId();
  const close = () => props.onClose?.();
  if (!props.open) return null;
  if (form.status === "unauthorized") return <Modal isOpen title="Sessão expirada" onClose={close}><p>Entre novamente para acessar os dados de atendimento. Não crie outra tentativa sem conferir o resultado anterior.</p></Modal>;
  if (!form.allowed) return null;
  const d = form.draft, product = form.services.find(row => row.id === d.productId), variants = product?.variants.filter(row => row.isActive) ?? [];
  const variant = variants.find(row => row.id === d.variantId), professional = form.professionals.find(row => row.id === d.professionalId);
  const schedule = product?.metadata?.serviceSchedule;
  const storedDuration = schedule && typeof schedule === "object" && !Array.isArray(schedule) ? (schedule as Record<string, unknown>).durationMinutes : undefined;
  const duration = form.slots?.durationMinutes ?? form.dates?.durationMinutes ?? storedDuration;
  const knownDuration = typeof duration === "number" && Number.isSafeInteger(duration) && duration >= 5 && duration <= 480;
  const knownPrice = variant && Number.isSafeInteger(variant.basePriceInCents) && variant.basePriceInCents > 0 && /^[A-Z]{3}$/.test(variant.currency);
  const policy = form.policy?.status === "configured" ? form.policy.policy : null;
  const detail = form.detail, disabled = form.locked;
  return <Modal isOpen title="Novo agendamento" eyebrow="Atendimento" subtitle="Escolha o cliente, o serviço e um horário. A disponibilidade e os valores são conferidos pelo sistema." size="lg" onClose={close}
    footer={<><span className="manual-appointment__footer-note">{form.locked ? "Esta tentativa permanece protegida enquanto você confere o resultado." : "Horário de Brasília · sem cobrança nesta tela"}</span><Button variant="outline" onClick={close}>Fechar</Button>
      {form.status === "editing" && <Button disabled={!form.ready || form.catalogLoading || form.calendarLoading} onClick={() => void form.submit()}>Criar agendamento</Button>}
      {form.status === "submitting" && <Button disabled>Criando agendamento…</Button>}
      {form.status === "uncertain" && <Button onClick={() => void form.retry()}>Repetir mesma tentativa</Button>}
      {form.status === "rejected" && <Button onClick={form.review}>Revisar dados</Button>}
      {form.status === "detail_error" && <Button onClick={() => void form.reconcileDetail()}>Recarregar detalhes</Button>}
      {form.status === "reconciling" && <Button disabled>Conferindo agendamento…</Button>}
      {form.status === "success" && <Button onClick={form.startNew}>Novo agendamento</Button>}</>}>
    <div className="manual-appointment">
      <section className="manual-appointment__policy" aria-label="Política atual de agendamento"><WalletCards size={20} aria-hidden="true" /><div>
        <strong>{!policy ? "Política de agendamento indisponível" : !policy.admissionsEnabled ? "Novos agendamentos suspensos" : policy.paymentMode === "online" ? "Pagamento online habilitado" : "Pagamento no atendimento"}</strong>
        <p>{!policy ? "Atualize as configurações antes de continuar." : policy.paymentMode === "online" ? "O agendamento manual fica pendente. O pagamento será preparado em uma etapa posterior." : "O valor a pagar no atendimento será registrado pelo sistema. Esta tela não registra um recebimento."}</p>
        {policy && <small>{policy.holdEnabled ? `Bloqueio temporário configurado: ${policy.holdMinutes} minutos.` : "Sem bloqueio temporário. Agendamentos confirmados ocupam a vaga."} Política v{form.policy?.version}.</small>}
      </div></section>
      {form.error && <div className="manual-appointment__notice" role="alert">{form.error}</div>}
      {detail && <section className="manual-appointment__receipt" aria-label="Resultado canônico"><strong>Agendamento conferido</strong><h3>{detail.serviceName}</h3>
        <dl><div><dt>Estado do atendimento</dt><dd>{statuses[detail.operationalStatus]}</dd></div><div><dt>Profissional</dt><dd>{detail.professionalName}</dd></div>
          <div><dt>Horário registrado</dt><dd>{formatAvailabilityInstant(detail.startsAt, detail.timeZone)}<br /><small>{detail.timeZone === "America/Sao_Paulo" ? "Horário de Brasília" : `Fuso registrado: ${detail.timeZone}`}</small></dd></div><div><dt>Valor do serviço</dt><dd>{money(detail.priceInCents, detail.currency)}</dd></div></dl>
        {!detail.payments.length ? <p>Sem registro de pagamento</p> : <ul className="manual-appointment__payments">{detail.payments.map(payment => <li key={payment.id}>
          <strong>{payment.mode === "at_attendance" && payment.status === "pending" ? "A pagar no atendimento" : payment.status === "approved" ? "Pagamento recebido" : payment.status === "pending" ? "Pagamento pendente" : payment.status === "failed" ? "Pagamento não concluído" : payment.status === "cancelled" ? "Pagamento cancelado" : payment.status === "refunded" ? "Pagamento reembolsado" : "Pagamento parcialmente reembolsado"}</strong>
          <span>{money(payment.amountCents, payment.currency)}</span>{payment.requiresRegularization && <small>Este registro requer regularização.</small>}
        </li>)}</ul>}
        <small>Dados conferidos em {formatAvailabilityInstant(detail.asOf, "America/Sao_Paulo")}. As situações do atendimento e do pagamento são independentes.</small>
      </section>}
      <fieldset disabled={disabled} className="manual-appointment__section"><legend><UserRound size={18} aria-hidden="true" /> Cliente</legend>
        <FormSelect label="Tipo de cliente" value={d.customerMode} onChange={value => form.update({ customerMode: value as "contact" | "known", knownCustomerId: "" })} disabled={disabled} options={[{ value: "contact", label: "Informar contato" }, { value: "known", label: "Selecionar cliente cadastrado" }]} />
        {d.customerMode === "contact" ? <><FormField label="Nome do contato" value={d.name} onChange={name => form.update({ name })} maxLength={200} disabled={disabled} />
          <div className="manual-appointment__grid"><FormField label="Telefone" type="tel" value={d.phone} onChange={phone => form.update({ phone })} maxLength={32} disabled={disabled} hint="Informe telefone ou e-mail para contato." />
            <FormField label="E-mail" type="email" value={d.email} onChange={email => form.update({ email })} maxLength={254} disabled={disabled} /></div></>
          : <><Button variant="outline" disabled={disabled || form.customerLoading} onClick={() => void form.loadCustomers()}>{form.customerLoading ? "Consultando clientes…" : form.customerCursor ? "Carregar mais clientes" : "Consultar clientes"}</Button>
            {form.customerError && <p role="alert">{form.customerError}</p>}
            <FormSelect label="Cliente cadastrado" value={d.knownCustomerId} onChange={knownCustomerId => form.update({ knownCustomerId })} disabled={disabled || form.customerLoading} options={[choice("Selecione na lista consultada"), ...form.customers.map(row => ({ value: row.id, label: typeof row.profile.fullName === "string" ? row.profile.fullName : typeof row.profile.name === "string" ? row.profile.name : "Cliente sem nome informado" }))]} /></>}
      </fieldset>
      <fieldset disabled={disabled} className="manual-appointment__section"><legend><CalendarDays size={18} aria-hidden="true" /> Serviço e profissional</legend>
        {!!form.categories.length && <FormSelect label="Categoria de atendimento" value={d.categoryId} onChange={categoryId => form.update({ categoryId })} disabled={disabled} options={[choice("Todas as categorias"), ...form.categories.filter(row => row.is_active).map(row => ({ value: row.id, label: row.name }))]} />}
        <FormSelect label="Serviço" value={d.productId} onChange={productId => form.update({ productId })} disabled={disabled || form.catalogLoading} options={[choice("Selecione um serviço"), ...form.services.filter(row => !d.categoryId || row.categoryId === d.categoryId).map(row => ({ value: row.id, label: row.name }))]} />
        {(form.catalogHasMore || form.catalogError) && <Button variant="outline" disabled={disabled || form.catalogLoading} onClick={() => void form.loadCatalog()}>{form.catalogError ? "Consultar serviços novamente" : "Carregar mais serviços"}</Button>}
        {form.catalogError && <p role="alert">Não foi possível consultar todos os serviços. As opções carregadas não representam o catálogo inteiro.</p>}
        {variants.length > 1 && <FormSelect label="Opção do serviço" value={d.variantId} onChange={variantId => form.update({ variantId })} disabled={disabled} options={[choice("Selecione uma opção"), ...variants.map(row => ({ value: row.id, label: row.sku }))]} />}
        <FormSelect label="Profissional" value={d.professionalId} onChange={professionalId => form.update({ professionalId })} disabled={disabled || !d.productId} options={[choice("Selecione um profissional vinculado"), ...form.professionals.map(row => ({ value: row.id, label: row.publicName }))]} />
        {form.professionalHasMore && <Button variant="outline" disabled={disabled || form.professionalLoading} onClick={() => void form.loadMoreProfessionals()}>Carregar mais profissionais</Button>}
      </fieldset>
      <fieldset disabled={disabled} className="manual-appointment__section"><legend><Clock3 size={18} aria-hidden="true" /> Data e horário</legend>
        <p className="manual-appointment__hint">Horário de Brasília</p>
        <div className="manual-appointment__toggle"><label htmlFor={oneOffId}>Informar horário avulso</label><ToggleSwitch id={oneOffId} checked={d.explicitOneOff} disabled={disabled} onChange={explicitOneOff => form.update({ explicitOneOff })} /></div>
        {d.explicitOneOff ? <><div className="form-field"><label htmlFor={wallId}>Data e hora em Brasília</label><input id={wallId} type="datetime-local" value={d.oneOffStart} disabled={disabled} onChange={event => form.update({ oneOffStart: event.target.value })} /></div>
          <FormTextarea label="Motivo do horário avulso (opcional)" value={d.reason} onChange={reason => form.update({ reason })} maxLength={1200} disabled={disabled} hint="O sistema conferirá sobreposições e a duração cadastrada do serviço." /></>
          : <><div className="manual-appointment__grid"><FormField label="Consultar a partir de" type="date" value={d.fromDate} onChange={fromDate => form.update({ fromDate })} disabled={disabled} /><FormField label="Consultar até" type="date" value={d.toDate} onChange={toDate => form.update({ toDate })} disabled={disabled} /></div>
            <Button variant="outline" onClick={() => void form.loadDates()} disabled={disabled || !form.ready || !d.professionalId || !d.variantId || form.calendarLoading}>Consultar datas</Button>
            {form.calendarLoading && <p role="status">Consultando disponibilidade atual…</p>}
            {form.dates?.status === "empty" && <p>Nenhuma data disponível no período consultado.</p>}
            {form.dates?.status === "stale" && <p>A grade mudou. Consulte as datas novamente.</p>}
            <FormSelect label="Data disponível" value={d.date} onChange={value => void form.selectDate(value)} disabled={disabled || form.calendarLoading || form.dates?.status !== "ready"} options={[choice("Selecione uma data consultada"), ...(form.dates?.dates ?? []).map(value => ({ value, label: value.split("-").reverse().join("/") }))]} />
            <FormSelect label="Horário disponível" value={d.slotStartsAt} onChange={slotStartsAt => form.update({ slotStartsAt })} disabled={disabled || form.calendarLoading || form.slots?.status !== "ready"} options={[choice("Selecione um horário consultado"), ...(form.slots?.slots ?? []).map(row => ({ value: row.startsAt, label: row.startTime }))]} />
            {form.slots?.status === "empty" && <p>Nenhum horário disponível nesta data.</p>}
            {form.calendarError && <p role="alert">{form.calendarError}</p>}</>}
      </fieldset>
      {product && <section className="manual-appointment__summary" aria-label="Resumo da seleção"><h3>Resumo da seleção</h3>
        <dl><div><dt>Serviço</dt><dd>{product.name}</dd></div><div><dt>Profissional</dt><dd>{professional?.publicName ?? "Selecione um profissional"}</dd></div>
          <div><dt>Duração cadastrada</dt><dd>{knownDuration ? `${duration} min` : "A conferir"}</dd></div>
          <div><dt>Valor do serviço</dt><dd>{knownPrice ? money(variant.basePriceInCents, variant.currency) : "A conferir"}</dd></div></dl>
        <p>O horário e os valores serão conferidos ao criar o agendamento.</p>
      </section>}
    </div>
  </Modal>;
}
