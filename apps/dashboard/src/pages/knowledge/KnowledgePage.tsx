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

const FIELDS: Array<{ key: keyof PolicyForm; label: string; placeholder: string }> = [
  { key: "returns", label: "Trocas e devoluções", placeholder: "Descreva a política de trocas e devoluções da sua loja..." },
  { key: "shipping", label: "Envio e frete", placeholder: "Descreva as opções e prazos de envio..." },
  { key: "warranty", label: "Garantia", placeholder: "Descreva a política de garantia dos produtos..." },
  { key: "payment", label: "Pagamento", placeholder: "Descreva formas de pagamento e parcelamento..." },
  { key: "general", label: "Informações gerais", placeholder: "Outras informações sobre a loja, horário de atendimento, etc." },
];

export function KnowledgePage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useKnowledgePage();
  const [activeTab, setActiveTab] = React.useState("policies");

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Base de Conhecimento</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  if (vm.loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Loader2 size={24} className="spin" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Base de Conhecimento</h1>
          <p className="page-lead">Configure as políticas da loja para que o agente IA responda perguntas de suporte com precisão</p>
        </div>
      </header>

      <div style={{ marginBottom: 20 }}>
        <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {activeTab === "policies" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {FIELDS.map((field) => (
            <div key={field.key} className="panel" style={{ padding: "16px 20px" }}>
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
              <textarea
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
                {vm.form[field.key].length}/5000
              </div>
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button onClick={vm.savePolicies} disabled={vm.saving}>
              {vm.saving ? "Salvando..." : "Salvar políticas"}
            </Button>
            {vm.indexing && (
              <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                Indexando...
              </span>
            )}
          </div>
        </div>
      )}

      {activeTab === "status" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14,
            }}
          >
            <StatCard
              label="Total de chunks"
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

          <div>
            <Button onClick={vm.reindexAll} disabled={vm.reindexing}>
              {vm.reindexing ? (
                <>
                  <Loader2 size={14} className="spin" style={{ marginRight: 6 }} />
                  Reindexando...
                </>
              ) : (
                <>
                  <RefreshCw size={14} style={{ marginRight: 6 }} />
                  Reindexar tudo
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
