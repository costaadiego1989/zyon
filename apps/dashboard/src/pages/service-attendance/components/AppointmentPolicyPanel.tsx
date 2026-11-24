import React, { useEffect, useId, useRef, useState } from "react";
import { Save } from "lucide-react";
import type { MerchantProfile } from "../../../api-client.js";
import type { ServiceBusinessPolicyDTO, ServiceBusinessPolicyUpdate } from "../../../api/endpoints/service-attendance.js";
import { Button } from "../../../components/Button.js";
import { DataPanel } from "../../../components/DataPanel.js";
import { FormField, FormSelect } from "../../../components/FormField.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { canManageServiceAttendance } from "../../../lib/auth/permissions.js";
import type { useServiceAttendancePage } from "../useServiceAttendancePage.js";
import { appointmentPolicyDraft, appointmentPolicyUpdate, type AppointmentPolicyDraft } from "./appointment-policy-form.js";
import "./appointment-policy-panel.css";

type ViewModel = ReturnType<typeof useServiceAttendancePage>;

export function AppointmentPolicyPanel({ me, vm }: { me: MerchantProfile; vm: ViewModel }) {
  if (!canManageServiceAttendance(me) || !vm.loadState.data) return null;
  const policy = vm.loadState.data.policy;
  if (policy.status === "invalid") return <DataPanel title="Política de agendamento"><p className="appointment-policy-message" role="alert">
    A política cadastrada precisa de revisão. Atualize para consultar a configuração antes de editar.
  </p></DataPanel>;
  return <PolicyEditor key={JSON.stringify([me.id, me.user_id])} policy={policy} vm={vm} />;
}

function PolicyEditor({ policy, vm }: { policy: ServiceBusinessPolicyDTO; vm: ViewModel }) {
  const [base, setBase] = useState(policy);
  const latestPolicy = useRef(policy);
  if (policy.version >= latestPolicy.current.version) latestPolicy.current = policy;
  const currentPolicy = latestPolicy.current;
  const [draft, setDraft] = useState(() => appointmentPolicyDraft(policy));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [working, setWorking] = useState(false);
  const active = useRef(true), operation = useRef(false);
  const onlineId = useId(), admissionId = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(appointmentPolicyDraft(base));
  const newer = currentPolicy.version > base.version
    || currentPolicy.version === base.version && currentPolicy.status !== base.status;
  const loading = vm.loadState.status === "loading";
  const uncertain = vm.command.status === "uncertain" || vm.command.status === "conflict";
  const blocked = working || loading || vm.command.status === "saving" || uncertain || newer;

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if ((!dirty && newer || resetRequested) && !loading) {
      setBase(currentPolicy); setDraft(appointmentPolicyDraft(currentPolicy)); setResetRequested(false); setSaved(false); setError(null);
    }
  }, [currentPolicy, dirty, newer, resetRequested, loading]);

  function change(update: Partial<AppointmentPolicyDraft>) {
    setDraft(current => ({ ...current, ...update })); setError(null); setSaved(false);
  }

  async function save() {
    if (blocked || operation.current || !dirty) return;
    let input: ServiceBusinessPolicyUpdate;
    try { input = appointmentPolicyUpdate(draft); } catch (cause) { setError((cause as Error).message); return; }
    operation.current = true; setWorking(true); setError(null); setSaved(false);
    try {
      const result = await vm.actions.updatePolicy(input);
      if (!active.current) return;
      if (result.status === "success" && result.value.status === "configured") {
        if (result.value.version < latestPolicy.current.version) return;
        latestPolicy.current = result.value;
        setBase(result.value); setDraft(appointmentPolicyDraft(result.value)); setSaved(true);
      } else if (result.status === "success") {
        setError("Não foi possível confirmar a configuração salva. Recarregue a política antes de continuar.");
      }
    } finally { operation.current = false; if (active.current) setWorking(false); }
  }

  async function reload() {
    if (operation.current || loading) return;
    operation.current = true; setWorking(true); setError(null); setSaved(false);
    try {
      const ok = await vm.refresh();
      if (active.current) {
        if (ok) setResetRequested(true);
        else setError("Não foi possível recarregar a política. Sua edição foi preservada.");
      }
    } finally { operation.current = false; if (active.current) setWorking(false); }
  }

  return <DataPanel title="Política de agendamento"><div className="appointment-policy">
    {currentPolicy.status === "configured" && <dl className="appointment-policy-summary" aria-label="Configuração atual">
      <div><dt>Pagamento</dt><dd>{currentPolicy.policy.paymentMode === "online" ? "Pagamento on-line" : "Pagamento no atendimento"}</dd></div>
      <div><dt>Reserva temporária</dt><dd>{currentPolicy.policy.holdEnabled ? `${currentPolicy.policy.holdMinutes} minutos` : "Desativada"}</dd></div>
      <div><dt>Admissão</dt><dd>Novos agendamentos: {currentPolicy.policy.admissionsEnabled ? "ativados" : "desativados"}</dd></div>
    </dl>}
    {currentPolicy.status === "unconfigured" && <p className="appointment-policy-message">Configure a reserva de horários para começar. A cobrança online começa desativada.</p>}
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="appointment-policy-row"><div><label htmlFor={onlineId}>Cobrança online</label>
        <p>{draft.online ? "O cliente conclui pelo checkout ao reservar o horário." : "O cliente agenda sem pagar agora. O valor fica registrado para pagamento no atendimento."}</p>
      </div><ToggleSwitch id={onlineId} checked={draft.online} disabled={blocked} onChange={online => change({ online })} /></div>
      <div className="appointment-policy-fields">
        <FormSelect label="Reserva temporária" value={draft.hold} disabled={blocked} onChange={hold => change({ hold: hold as AppointmentPolicyDraft["hold"] })}
          options={[{ value: "", label: "Selecione uma opção" }, { value: "off", label: "Sem bloqueio temporário" }, { value: "on", label: "Bloquear durante a escolha" }]}
          hint="Um agendamento confirmado sempre ocupa o horário, mesmo sem bloqueio temporário." />
        {draft.hold === "on" && <FormField label="Duração da reserva (minutos)" value={draft.holdMinutes} maxLength={10} disabled={blocked}
          inputProps={{ inputMode: "numeric" }} onChange={holdMinutes => change({ holdMinutes })} />}
      </div>
      <div className="appointment-policy-row"><div><label htmlFor={admissionId}>Aceitar novos agendamentos</label>
        <p>Permita novas reservas após revisar os serviços, profissionais e horários cadastrados.</p>
      </div><ToggleSwitch id={admissionId} checked={draft.admissionsEnabled} disabled={blocked} onChange={admissionsEnabled => change({ admissionsEnabled })} /></div>
      <p className="appointment-policy-note">As alterações valem para novas seleções de horário. Reservas confirmadas e pagamentos iniciados mantêm os termos registrados.</p>
      {error && <p className="appointment-policy-error" role="alert">{error}</p>}
      {saved && <p className="appointment-policy-message" role="status">Configuração salva.</p>}
      {newer && <p className="appointment-policy-message" role="status">A configuração foi atualizada. Recarregue a política para revisar os valores atuais.</p>}
      <div className="appointment-policy-actions"><Button type="submit" loading={working} disabled={blocked || !dirty}><Save size={16} aria-hidden="true" />Salvar política</Button>
        {(uncertain || newer || error) && <Button variant="outline" disabled={working || loading} onClick={() => void reload()}>Recarregar política</Button>}
      </div>
    </form>
  </div></DataPanel>;
}
