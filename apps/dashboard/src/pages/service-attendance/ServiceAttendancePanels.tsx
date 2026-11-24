import React from "react";
import type { MerchantProfile } from "../../api-client.js";
import { DataPanel } from "../../components/DataPanel.js";
import { Button } from "../../components/Button.js";
import type { ServiceAttendanceFilters, useServiceAttendancePage } from "./useServiceAttendancePage.js";
import { ProfessionalsPanel } from "./components/ProfessionalsPanel.js";
import { ServiceCategoriesPanel } from "./components/ServiceCategoriesPanel.js";
import { AvailabilityPanel } from "./components/AvailabilityPanel.js";

type ViewModel = ReturnType<typeof useServiceAttendancePage>;
export function ServiceAttendancePanels({ tab, vm, me }: { tab: ServiceAttendanceFilters["tab"]; vm: ViewModel; me: MerchantProfile }) {
  const data = vm.loadState.data;
  if (!data) return null;
  if (tab === "agenda") return <DataPanel title="Consulta da agenda"><div style={{ padding: 20, display: "grid", gap: 12 }}><p>Escolha um profissional e consulte a grade e as exceções cadastradas.</p><Button variant="outline" onClick={() => vm.setFilters({ tab: "availability" })}>Consultar grade cadastrada</Button></div></DataPanel>;
  if (tab === "professionals") return <ProfessionalsPanel me={me} vm={vm} />;
  if (tab === "categories") return <ServiceCategoriesPanel me={me} vm={vm} />;
  if (tab === "availability") return <AvailabilityPanel me={me} vm={vm} />;
  return <DataPanel title="Política de agendamento"><div style={{ padding: 20 }}>
    {data.policy.status !== "configured" ? <p>{data.policy.status === "invalid" ? "A política cadastrada precisa de revisão." : "A política de agendamento ainda não foi configurada."}</p> : <dl>
      <dt>Forma de pagamento</dt><dd>{data.policy.policy.paymentMode === "online" ? "Pagamento on-line" : "Pagamento no atendimento"}</dd>
      <dt>Reserva temporária</dt><dd>{data.policy.policy.holdEnabled ? `${data.policy.policy.holdMinutes} minutos` : "Desativada"}</dd>
      <dt>Admissão</dt><dd>Novos agendamentos: {data.policy.policy.admissionsEnabled ? "ativados" : "desativados"}</dd>
    </dl>}
  </div></DataPanel>;
}
