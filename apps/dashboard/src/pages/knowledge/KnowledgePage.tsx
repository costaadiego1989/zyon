import { PageLoader } from "../../components/PageLoader.js";
import { PageHeader } from "../../components/PageHeader.js";
import React from "react";
import { BookOpen, Database, Loader2, RefreshCw } from "lucide-react";
import { TabBar } from "../../components/TabBar.js";
import { Button } from "../../components/Button.js";
import { StatCard } from "../overview/components/StatCard.js";
import type { MerchantProfile } from "../../api-client.js";
import { useKnowledgePage, type PolicyForm } from "./useKnowledgePage.js";

const TABS = [
  { key: "policies", label: "Políticas" },
  { key: "status", label: "Status" },
];

const FIELDS: Array<{ key: keyof PolicyForm; label: string; placeholder: string; hint: string }> = [
  { key: "returns", hint: "Em quais condições o cliente pode pedir troca ou devolução? Como ele entra em contato?", label: "Trocas e devoluções", placeholder: "Descreva a política de trocas e devoluções da sua loja..." },
  { key: "shipping", hint: "Quais regiões a loja atende? Como o cliente consulta os prazos e acompanha o envio?", label: "Envio e frete", placeholder: "Descreva as opções e prazos de envio..." },
  { key: "warranty", hint: "Quais produtos têm garantia? Como solicitar atendimento e quais informações são necessárias?", label: "Garantia", placeholder: "Descreva a política de garantia dos produtos..." },
  { key: "payment", hint: "Quais formas de pagamento estão disponíveis? Explique as condições que a loja realmente oferece.", label: "Pagamento", placeholder: "Descreva formas de pagamento e parcelamento..." },
  { key: "general", hint: "Qual é o horário de atendimento? Inclua canais de contato e informações úteis sobre a empresa.", label: "Informações gerais", placeholder: "Outras informações sobre a loja, horário de atendimento, etc." },
];

export function KnowledgePage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useKnowledgePage();
  const [activeTab, setActiveTab] = React.useState("policies");

  if (!props.me) {
    return (
      <PageHeader title="Base de conhecimento" description="Login necessário" />
    );
  }

  if (vm.loading) {
    return (
      <PageLoader variant="section" />
    );
  }

  return (
    <div className="page-container">
      <PageHeader title="Base de conhecimento" description="Descreva as regras da loja para orientar as respostas do agente aos clientes." />

      <div>
        <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {vm.loadError && <div role="alert" className="ui-notice ui-notice--error"><p>{vm.loadError}</p><Button variant="outline" onClick={vm.refresh}>Tentar novamente</Button></div>}
      {activeTab === "policies" && !vm.loadError && (
        <div className="configuration-layout"><div className="configuration-sections">
          {FIELDS.map((field) => (
            <section key={field.key} className="configuration-section">
              <label
                htmlFor={`policy-${field.key}`}
                style={{
                  display: "block",
                  font: "600 13px var(--font-sans)",
                  color: "var(--color-text)",
                  marginBottom: 8,
                }}
              >
                {field.label}
              </label>
              <p id={"policy-help-" + field.key} className="ui-field-help" style={{ marginBottom: 12 }}>{field.hint}</p>
              <textarea aria-describedby={"policy-help-" + field.key}
                id={`policy-${field.key}`}
                value={vm.form[field.key]}
                onChange={(e) => vm.setField(field.key, e.target.value)}
                placeholder={field.placeholder}
                maxLength={5000}
                rows={4}
                style={{
                  width: "100%",
                  background: "var(--surface-1)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  font: "13px/1.5 var(--font-sans)",
                  color: "var(--color-text)",
                  resize: "vertical",
                  minHeight: 80,
                }}
              />
              <div style={{ marginTop: 4, font: "11px var(--font-sans)", color: "var(--color-text-faint)", textAlign: "right" }}>
                {vm.form[field.key].length.toLocaleString("pt-BR")} / 5.000 caracteres
              </div>
            </section>
          ))}

          <div className="configuration-actions">
            <Button onClick={vm.savePolicies} loading={vm.saving}>
              {vm.saving ? "Salvando..." : "Salvar políticas"}
            </Button>
            {vm.indexing && (
              <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                Consultando o estado da base...
              </span>
            )}
          </div>
        </div><aside className="configuration-aside"><h2>Escreva como você atende</h2><p>Use frases curtas, condições claras e informações atualizadas. Não inclua prazos ou benefícios que a loja não oferece.</p><h2>O que o agente vai aprender</h2><p>As políticas ajudam a responder dúvidas dos clientes. Salvar o texto e atualizar a base são etapas distintas.</p><p>Confira os trechos disponíveis na aba Status. A quantidade de trechos não corresponde à quantidade de documentos.</p></aside></div>
      )}

      {activeTab === "status" && !vm.loadError && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--page-section-gap, 24px)" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14,
            }}
          >
            <StatCard
              label="Trechos indexados"
              value={vm.status?.total ?? 0}
              icon={<Database size={16} />}
            />
            <StatCard
              label="Produtos"
              value={vm.status?.products ?? 0}
              icon={<BookOpen size={16} />}
            />
            <StatCard
              label="Políticas"
              value={vm.status?.policies ?? 0}
              icon={<BookOpen size={16} />}
            />
            <StatCard
              label="FAQ"
              value={vm.status?.faq ?? 0}
              icon={<BookOpen size={16} />}
            />
          </div>

          <p className="ui-field-help">Os valores representam trechos disponíveis para consulta pelo agente, não documentos. Atualize a base para processar novamente os conteúdos da loja.</p>
          <div>
            <Button onClick={vm.reindexAll} disabled={vm.reindexing}>
              {vm.reindexing ? (
                <>
                  <Loader2 size={14} className="spin" style={{ marginRight: 6 }} />
                  Atualizando base...
                </>
              ) : (
                <>
                  <RefreshCw size={14} style={{ marginRight: 6 }} />
                  Atualizar base
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
