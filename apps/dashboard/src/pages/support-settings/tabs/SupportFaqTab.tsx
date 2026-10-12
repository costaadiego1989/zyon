import React from "react";
import { MessageSquare, Plus, Save } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState.js";
import { Button } from "../../../components/Button.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { PageLoader } from "../../../components/PageLoader.js";
import { useSupportFaq } from "../hooks/useSupportFaq.js";
import { FaqEditor } from "../components/FaqEditor.js";
type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;
export function SupportFaqTab({ api }: { api: DashboardApi }) {
  const vm = useSupportFaq(api);
  return <section className="panel support-faq configuration-form">
    <SectionHeader title="Perguntas frequentes" subtitle="Prepare respostas sobre entrega, trocas e seus produtos para orientar o atendimento automático no checkout." trailing={<span className="badge muted">{vm.items.length} de 20 perguntas</span>} />
    {vm.loading ? <PageLoader /> : vm.loadError ? <EmptyState icon={MessageSquare} title="Perguntas indisponíveis" description={vm.loadError} action={<Button variant="outline" onClick={() => void vm.reload()}>Tentar novamente</Button>} /> : <>
      {vm.message && <div className="panel-error" role="alert">{vm.message.text}</div>}
      {vm.items.length ? <div className="support-faq__items">{vm.items.map((item, index) => <FaqEditor key={item.id} item={item} index={index} disabled={vm.saving} onUpdate={(field, value) => vm.updateItem(item.id, field, value)} onRemove={() => vm.removeItem(item.id)} />)}</div> : <EmptyState icon={MessageSquare} title="Adicione a primeira pergunta" description="Comece pela dúvida que sua equipe recebe com mais frequência. Revise a resposta antes de salvar." />}
      <div className="support-faq__actions">
        {vm.items.length < 20 ? <Button variant="outline" disabled={vm.saving} onClick={vm.addItem}><Plus size={16} /> Adicionar pergunta</Button> : <p>Limite de 20 perguntas atingido.</p>}
        <Button variant="primary" loading={vm.saving} disabled={!vm.dirty || !vm.valid || vm.saving} onClick={() => void vm.save()}><Save size={16} /> Salvar perguntas</Button>
      </div>
      <p className="support-faq__hint" role="status">{!vm.valid ? "Preencha a pergunta e a resposta de cada item para salvar." : vm.dirty ? "Há alterações não salvas. Salve para aplicar as respostas ao atendimento." : "As alterações são aplicadas depois de salvar."}</p>
    </>}
  </section>;
}
