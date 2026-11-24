import React, { lazy, Suspense, useState } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { DataPanel } from "../../components/DataPanel.js";
import { Button } from "../../components/Button.js";
import type { ServiceAttendanceFilters, useServiceAttendancePage } from "./useServiceAttendancePage.js";
import { ProfessionalsPanel } from "./components/ProfessionalsPanel.js";
import { ServiceCategoriesPanel } from "./components/ServiceCategoriesPanel.js";
import { AvailabilityPanel } from "./components/AvailabilityPanel.js";
import { AppointmentPolicyPanel } from "./components/AppointmentPolicyPanel.js";
const ManualAppointmentDrawer = lazy(() => import("./components/ManualAppointmentDrawer.js").then(module => ({ default: module.ManualAppointmentDrawer })));

type ViewModel = ReturnType<typeof useServiceAttendancePage>;
/** Administrative panels share one mounted manual command controller across tabs. */
export function ServiceAttendancePanels({ tab, vm, me }: { tab: ServiceAttendanceFilters["tab"]; vm: ViewModel; me: MerchantProfile }) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLoaded, setManualLoaded] = useState(false);
  const data = vm.loadState.data;
  const content = !data ? null : tab === "agenda" ? <DataPanel title="Consulta da agenda"><div style={{ padding: 20, display: "grid", gap: 12 }}><p>Escolha um profissional e consulte a grade e as exceções cadastradas.</p><div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}><Button onClick={() => { setManualLoaded(true); setManualOpen(true); }}>Novo agendamento</Button><Button variant="outline" onClick={() => vm.setFilters({ tab: "availability" })}>Consultar grade cadastrada</Button></div></div></DataPanel>
    : tab === "professionals" ? <ProfessionalsPanel me={me} vm={vm} /> : tab === "categories" ? <ServiceCategoriesPanel me={me} vm={vm} />
      : tab === "availability" ? <AvailabilityPanel me={me} vm={vm} /> : <AppointmentPolicyPanel me={me} vm={vm} />;
  return <>{content}{manualLoaded && <Suspense fallback={<p role="status">Abrindo novo agendamento…</p>}><ManualAppointmentDrawer me={me} vm={vm} open={manualOpen} onClose={() => setManualOpen(false)} /></Suspense>}</>;
}
