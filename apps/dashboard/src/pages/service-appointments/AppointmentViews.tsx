import React, { useState } from "react";
import { CalendarDays, Columns3, List } from "lucide-react";
import type { ServiceAppointmentAdminItem } from "@zyon/shared-types";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { TabBar } from "../../components/TabBar.js";
import { formatAppointmentStart } from "./appointment-board.js";
import type { AppointmentReadSnapshot } from "./appointment-read-snapshot.js";
import "./appointment-views.css";

interface Props {
  snapshot: AppointmentReadSnapshot;
  busy?: boolean;
  onOpen: (appointmentId: string) => void;
  onFirstPage: () => void;
  onNextPage: () => void;
}
const money = (amount: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount / 100);
const zoneLabel = (timeZone: string) => timeZone === "America/Sao_Paulo" ? "Horário de Brasília"
  : timeZone === "UTC" ? "Horário UTC" : `Fuso registrado: ${timeZone}`;
function paymentLabel(item: ServiceAppointmentAdminItem): string {
  if (!item.payments.length) return "Sem registro de pagamento";
  if (item.payments.length > 1) return `${item.payments.length} registros de pagamento`;
  const payment = item.payments[0];
  return ({ approved: "Pago", failed: "Pagamento recusado", cancelled: "Pagamento cancelado", refunded: "Estornado", partially_refunded: "Estorno parcial",
    pending: payment.mode === "at_attendance" ? "A pagar no atendimento" : "Aguardando pagamento" })[payment.status];
}
function AppointmentFacts({ item }: { item: ServiceAppointmentAdminItem }) {
  return <>
    <strong className="appointment-record__customer">{item.customer.name ?? "Cliente sem nome informado"}</strong>
    <span className="appointment-record__service">{item.serviceName}</span>
    <span className="appointment-record__professional">{item.professionalName}</span>
    <time dateTime={item.startsAt}>{formatAppointmentStart(item)} · {item.durationMinutes} min</time>
    <span className="appointment-record__zone">{zoneLabel(item.timeZone)}</span>
    <span className="appointment-record__money"><span>Valor do serviço</span><strong>{money(item.priceInCents, item.currency)}</strong></span>
    <span className="appointment-record__payment">{paymentLabel(item)}</span>
    {item.payments.some(payment => payment.requiresRegularization) && <span className="appointment-record__attention">Conferir registro financeiro</span>}
  </>;
}

/** Present the same validated read in either view. Selection opens canonical
 * appointment details; changing views never changes attendance or finance. */
export function AppointmentViews({ snapshot, busy = false, onOpen, onFirstPage, onNextPage }: Props) {
  const [view, setView] = useState("kanban");
  const { page, board } = snapshot;
  const items = new Map(page.items.map(item => [item.id, item]));
  return <section className="appointment-views" aria-label="Agendamentos" aria-busy={busy}>
    <div className="appointment-views__toolbar">
      <TabBar role="group" label="Visualização dos agendamentos" activeTab={view} onTabChange={setView}
        tabs={[{ key: "kanban", label: "Kanban", icon: <Columns3 size={16} /> }, { key: "list", label: "Lista", icon: <List size={16} /> }]} />
      <p role="status">{board.loadedCount} de {page.totalCount} agendamentos nesta página</p>
    </div>
    {page.totalCount === 0 ? <EmptyState icon={CalendarDays} title="Nenhum agendamento neste período"
      description="Escolha outro período ou ajuste os filtros para consultar a agenda." /> : view === "kanban" ?
      <div className="appointment-kanban" role="region" aria-label="Quadro de agendamentos" tabIndex={0}>
        {board.columns.map(column => <section key={column.status} className="appointment-kanban__column" data-appointment-status={column.status} aria-label={column.label}>
          <header><h3>{column.label}</h3><span aria-label={`${page.countsByStatus[column.status]} agendamentos`}>{page.countsByStatus[column.status]}</span></header>
          <div className="appointment-kanban__records">
            {column.entries.map(entry => { const item = items.get(entry.id)!; return <button type="button" key={entry.id} data-appointment-id={entry.id}
              className="appointment-record" disabled={busy} onClick={() => onOpen(entry.id)} aria-label={`Abrir agendamento de ${item.customer.name ?? "cliente sem nome"}: ${item.serviceName}`}>
              <AppointmentFacts item={item} />
            </button>; })}
            {!column.entries.length && <p className="appointment-kanban__empty">{page.countsByStatus[column.status] ? "Há agendamentos em outras páginas." : "Nenhum agendamento nesta etapa."}</p>}
          </div>
        </section>)}
      </div> : <div className="appointment-list" role="region" aria-label="Lista de agendamentos" tabIndex={0}>
        <table><caption className="sr-only">Agendamentos da página atual</caption><thead><tr><th scope="col">Cliente e serviço</th><th scope="col">Profissional e horário</th><th scope="col">Etapa</th><th scope="col">Valor e pagamento</th><th scope="col"><span className="sr-only">Detalhes</span></th></tr></thead>
          <tbody>{page.items.map(item => <tr key={item.id} data-appointment-id={item.id}>
            <td data-label="Cliente e serviço"><strong>{item.customer.name ?? "Cliente sem nome informado"}</strong><span>{item.serviceName}</span></td>
            <td data-label="Profissional e horário"><strong>{item.professionalName}</strong><time dateTime={item.startsAt}>{formatAppointmentStart(item)}</time><span>{item.durationMinutes} min · {zoneLabel(item.timeZone)}</span></td>
            <td data-label="Etapa">{board.columns.find(column => column.status === item.operationalStatus)!.label}</td>
            <td data-label="Valor e pagamento"><span>Valor do serviço</span><strong>{money(item.priceInCents, item.currency)}</strong><span>{paymentLabel(item)}</span>{item.payments.some(payment => payment.requiresRegularization) && <span className="appointment-record__attention">Conferir registro financeiro</span>}</td>
            <td><Button variant="outline" size="sm" disabled={busy} onClick={() => onOpen(item.id)} aria-label={`Abrir agendamento de ${item.customer.name ?? "cliente sem nome"}: ${item.serviceName}`}>Ver detalhes</Button></td>
          </tr>)}</tbody>
        </table>
        {page.items.length === 0 && <p className="appointment-list__empty">Não há registros nesta página. Volte à primeira página para consultar os agendamentos.</p>}
      </div>}
    {page.totalCount > 0 && <footer className="appointment-views__pagination">
      <span>Consulte os detalhes para acompanhar o atendimento e os registros de pagamento.</span>
      <div><Button variant="outline" disabled={busy} onClick={onFirstPage}>Primeira página</Button><Button variant="outline" disabled={busy || !page.nextCursor} onClick={onNextPage}>Próxima página</Button></div>
    </footer>}
  </section>;
}
