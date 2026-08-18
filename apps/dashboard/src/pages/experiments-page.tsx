import React from "react";
import { Save, Plus, X, Trash2, Play, Pause, Trophy, ArrowUpRight } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { Button } from "../components/Button.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { Modal } from "../components/Modal.js";
import { SearchInput } from "../components/SearchInput.js";
import { useExperimentsPage, type ExperimentForm, type Experiment } from "./useExperimentsPage.js";

export interface ExperimentsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function ExperimentsPage(props: ExperimentsPageProps) {
  const vm = useExperimentsPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Testes A/B</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <span className="eyebrow">CONFIGURAÇÃO</span>
          <h1>Testes A/B</h1>
          <p className="page-lead">Experimente variações de ofertas e mensagens</p>
        </div>
        <Button variant="primary" size="sm" arrow onClick={vm.openCreateForm}>
          <Plus size={14} /> Novo Teste
        </Button>
      </div>

      {/* List */}
      {vm.loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)" }}>Carregando testes...</div>
      ) : vm.experiments.length === 0 ? (
        <EmptyState
          title="Nenhum teste A/B"
          description="Crie seu primeiro teste para começar a experimentar"
          action={<Button size="sm" onClick={vm.openCreateForm}>Criar Teste</Button>}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <SearchInput value={vm.searchText} onChange={vm.setSearchText} placeholder="Buscar testes..." />
            <select
              value={vm.filterStatus}
              onChange={(e) => vm.setFilterStatus(e.target.value as any)}
              style={{
                padding: "7px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--ink)",
                font: "12px var(--sans)",
                minWidth: 120,
              }}
            >
              <option value="all">Todos</option>
              <option value="draft">Rascunho</option>
              <option value="running">Em Execução</option>
              <option value="completed">Concluído</option>
            </select>
            <select
              value={vm.sortBy}
              onChange={(e) => vm.setSortBy(e.target.value as any)}
              style={{
                padding: "7px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--ink)",
                font: "12px var(--sans)",
                minWidth: 120,
              }}
            >
              <option value="created">Mais Recentes</option>
              <option value="name">Nome A-Z</option>
              <option value="status">Status</option>
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16 }}>
            {/* List Column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {vm.experiments.map((exp) => (
                <ExperimentListItem
                  key={exp.id}
                  experiment={exp}
                  selected={vm.selectedId === exp.id}
                  onSelect={() => vm.setSelectedId(vm.selectedId === exp.id ? null : exp.id)}
                />
              ))}
            </div>

            {/* Detail Column */}
            {vm.selectedId && vm.selectedExperiment ? (
              <ExperimentDetail
                experiment={vm.selectedExperiment}
                results={vm.selectedResults}
                loading={vm.resultsLoading}
                saving={vm.saving}
                onStart={() => vm.handleStartExperiment(vm.selectedId!)}
                onStop={() => vm.handleStopExperiment(vm.selectedId!)}
                onPromote={(variantId) => vm.handlePromoteVariant(vm.selectedId!, variantId)}
                onArchive={() => vm.handleArchiveExperiment(vm.selectedId!)}
              />
            ) : (
              <div
                style={{
                  background: "var(--card)",
                  border: "1px dashed var(--border)",
                  borderRadius: 14,
                  padding: 24,
                  textAlign: "center",
                  color: "var(--muted)",
                }}
              >
                <p>Selecione um teste para ver detalhes</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {vm.formMode && (
        <CreateExperimentModal
          form={vm.form}
          errors={vm.errors}
          loading={vm.saving}
          onClose={vm.closeForm}
          onSave={vm.handleCreateExperiment}
          patch={vm.patch}
          addVariant={vm.addVariant}
          removeVariant={vm.removeVariant}
          updateVariant={vm.updateVariant}
        />
      )}
    </div>
  );
}

function ExperimentListItem({
  experiment,
  selected,
  onSelect,
}: {
  experiment: Experiment;
  selected: boolean;
  onSelect: () => void;
}) {
  const statusLabel = {
    draft: "Rascunho",
    running: "Em Execução",
    paused: "Pausado",
    completed: "Concluído",
    archived: "Arquivado",
  }[experiment.status];

  const statusColor = {
    draft: "var(--muted)",
    running: "var(--accent)",
    paused: "var(--faint)",
    completed: "var(--good)",
    archived: "var(--muted)",
  }[experiment.status];

  return (
    <button
      onClick={onSelect}
      style={{
        background: selected ? "var(--accent-soft)" : "var(--card)",
        border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 16px",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>{experiment.name}</span>
        <span style={{ font: "11px var(--mono)", color: statusColor, background: "rgba(0,0,0,0.1)", padding: "2px 6px", borderRadius: 3 }}>
          {statusLabel}
        </span>
      </div>
      <div style={{ font: "11px var(--sans)", color: "var(--muted)" }}>
        {experiment.variants.length} variantes • {new Date(experiment.created_at).toLocaleDateString("pt-BR")}
      </div>
    </button>
  );
}

interface ExperimentDetailProps {
  experiment: Experiment;
  results: any;
  loading: boolean;
  saving: boolean;
  onStart: () => void;
  onStop: () => void;
  onPromote: (variantId: string) => void;
  onArchive: () => void;
}

function ExperimentDetail({
  experiment,
  results,
  loading,
  saving,
  onStart,
  onStop,
  onPromote,
  onArchive,
}: ExperimentDetailProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h3 style={{ font: "600 14px var(--sans)", color: "var(--ink)", margin: 0, marginBottom: 4 }}>{experiment.name}</h3>
            <p style={{ font: "12px var(--sans)", color: "var(--muted)", margin: 0 }}>
              Criado em {new Date(experiment.created_at).toLocaleDateString("pt-BR")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {experiment.status === "draft" && (
              <Button size="sm" variant="primary" onClick={onStart} loading={saving}>
                <Play size={12} /> Iniciar
              </Button>
            )}
            {experiment.status === "running" && (
              <Button size="sm" variant="outline" onClick={onStop} loading={saving}>
                <Pause size={12} /> Pausar
              </Button>
            )}
            {experiment.status !== "archived" && (
              <Button size="sm" variant="ghost" onClick={onArchive} loading={saving}>
                <Trash2 size={12} /> Arquivar
              </Button>
            )}
          </div>
        </div>

        {/* Variants */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 8 }}>VARIANTES</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {experiment.variants.map((v) => (
              <span
                key={v.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: v.id === experiment.control_variant_id ? "var(--accent-soft)" : "var(--bg)",
                  color: v.id === experiment.control_variant_id ? "var(--accent)" : "var(--muted)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  font: "11px var(--sans)",
                }}
              >
                {v.name}
                {v.id === experiment.control_variant_id && <span style={{ font: "9px" }}>CONTROL</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ padding: "20px", textAlign: "center", color: "var(--faint)" }}>Carregando resultados...</div>
      ) : results ? (
        <ExperimentResultsPanel
          results={results}
          experiment={experiment}
          saving={saving}
          onPromote={onPromote}
        />
      ) : (
        <div style={{ background: "var(--card)", border: "1px dashed var(--border)", borderRadius: 10, padding: 20, textAlign: "center", color: "var(--muted)" }}>
          Sem resultados ainda
        </div>
      )}
    </div>
  );
}

interface ResultsPanelProps {
  results: any;
  experiment: Experiment;
  saving: boolean;
  onPromote: (variantId: string) => void;
}

function ExperimentResultsPanel({
  results,
  experiment,
  saving,
  onPromote,
}: ResultsPanelProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Confidence */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>CONFIANÇA</span>
            <span style={{ font: "24px var(--mono)", color: "var(--accent)" }}>
              {results.confidence_level}%
            </span>
          </div>
          <SignificanceIndicator confidence={results.confidence_level} />
        </div>
      </div>

      {/* Metrics Table */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>MÉTRICAS POR VARIANTE</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "12px var(--mono)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", font: "600 11px var(--sans)", color: "var(--muted)" }}>Variante</th>
                <th style={{ padding: "10px 16px", textAlign: "right", font: "600 11px var(--sans)", color: "var(--muted)" }}>Visitantes</th>
                <th style={{ padding: "10px 16px", textAlign: "right", font: "600 11px var(--sans)", color: "var(--muted)" }}>Conversões</th>
                <th style={{ padding: "10px 16px", textAlign: "right", font: "600 11px var(--sans)", color: "var(--muted)" }}>Taxa</th>
                <th style={{ padding: "10px 16px", textAlign: "right", font: "600 11px var(--sans)", color: "var(--muted)" }}>AOV</th>
              </tr>
            </thead>
            <tbody>
              {results.metrics.map((m: any) => {
                const variant = experiment.variants.find((v) => v.id === m.variant_id);
                const isWinner = results.winner_variant_id === m.variant_id;
                return (
                  <tr key={m.variant_id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px", color: "var(--ink)" }}>
                      {variant?.name}
                      {isWinner && <Trophy size={12} style={{ marginLeft: 6, display: "inline", color: "var(--accent)" }} />}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--ink)" }}>{m.total_visitors}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--ink)" }}>{m.conversions}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: isWinner ? "var(--good)" : "var(--ink)" }}>
                      {(m.conversion_rate * 100).toFixed(2)}%
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--ink)" }}>
                      R$ {m.avg_order_value?.toFixed(2) ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Promote Button */}
      {results.winner_variant_id && (
        <Button
          variant="primary"
          onClick={() => onPromote(results.winner_variant_id)}
          disabled={results.confidence_level < 95}
          loading={saving}
        >
          <ArrowUpRight size={14} />
          Promover Variante Vencedora {results.confidence_level < 95 ? `(${results.confidence_level}% < 95%)` : ""}
        </Button>
      )}
    </div>
  );
}

function SignificanceIndicator({ confidence }: { confidence: number }) {
  if (confidence >= 95) {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ font: "28px", marginBottom: 4 }}>✓</div>
        <span style={{ font: "11px var(--sans)", color: "var(--good)" }}>Significante</span>
      </div>
    );
  }
  if (confidence >= 80) {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ font: "28px", marginBottom: 4 }}>◐</div>
        <span style={{ font: "11px var(--sans)", color: "var(--accent)" }}>Pendente</span>
      </div>
    );
  }
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ font: "28px", marginBottom: 4 }}>○</div>
      <span style={{ font: "11px var(--sans)", color: "var(--muted)" }}>Inicial</span>
    </div>
  );
}

interface CreateExperimentModalProps {
  form: ExperimentForm;
  errors: Record<string, string>;
  loading: boolean;
  onClose: () => void;
  onSave: () => void;
  patch: (p: Partial<ExperimentForm>) => void;
  addVariant: () => void;
  removeVariant: (idx: number) => void;
  updateVariant: (idx: number, updates: any) => void;
}

function CreateExperimentModal({
  form,
  errors,
  loading,
  onClose,
  onSave,
  patch,
  addVariant,
  removeVariant,
  updateVariant,
}: CreateExperimentModalProps) {
  return (
    <Modal isOpen={true} title="Novo Teste A/B" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Name */}
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Nome do Teste</span>
            <input
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Ex: Desconto 15% vs 20%"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: `1px solid ${errors.name ? "var(--danger)" : "var(--border)"}`,
                background: "var(--bg)",
                color: "var(--ink)",
                font: "13px var(--sans)",
              }}
            />
            {errors.name && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.name}</span>}
          </label>

          {/* Description */}
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
              Descrição (opcional)
            </span>
            <textarea
              value={form.description ?? ""}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Objetivo do teste..."
              rows={2}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--ink)",
                font: "13px var(--sans)",
                resize: "vertical",
              }}
            />
          </label>

          {/* Sample Size */}
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Tamanho da Amostra</span>
            <input
              type="number"
              value={form.sample_size}
              onChange={(e) => patch({ sample_size: Number(e.target.value) })}
              min="10"
              max="1000000"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: `1px solid ${errors.sample_size ? "var(--danger)" : "var(--border)"}`,
                background: "var(--bg)",
                color: "var(--ink)",
                font: "13px var(--mono)",
              }}
            />
            {errors.sample_size && (
              <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.sample_size}</span>
            )}
          </label>

          {/* Variants */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>VARIANTES</span>
              <Button size="sm" onClick={addVariant}>
                <Plus size={12} /> Adicionar
              </Button>
            </div>
            {errors.variants && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginBottom: 8, display: "block" }}>{errors.variants}</span>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {form.variants.map((v, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "start" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <input
                      value={v.name}
                      onChange={(e) => updateVariant(idx, { name: e.target.value })}
                      placeholder="Nome da variante"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--ink)",
                        font: "12px var(--sans)",
                      }}
                    />
                    <textarea
                      value={v.description ?? ""}
                      onChange={(e) => updateVariant(idx, { description: e.target.value })}
                      placeholder="Descrição (ex: desconto, mensagem)"
                      rows={2}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--ink)",
                        font: "12px var(--sans)",
                        resize: "vertical",
                      }}
                    />
                  </div>
                  {form.variants.length > 2 && (
                    <button
                      onClick={() => removeVariant(idx)}
                      style={{
                        marginTop: 2,
                        background: "var(--danger-soft)",
                        border: "1px solid var(--danger)",
                        borderRadius: 6,
                        padding: "6px 8px",
                        cursor: "pointer",
                        color: "var(--danger)",
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSave} loading={loading} disabled={Object.keys(errors).length > 0}>
            <Save size={14} /> Criar Teste
          </Button>
        </div>
      </div>
    </Modal>
  );
}
