import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "../../../components/Button.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { FormField, FormTextarea } from "../../../components/FormField.js";
import { showToast } from "../../../components/Toast.js";
import { useSupportFaq } from "../hooks/useSupportFaq.js";
import { FaqEditor } from "../components/FaqEditor.js";
import type { DashboardHttpError } from "../../../api-client.js";
import { createDashboardApi } from "../../../api-client.js";

type DashboardApi = ReturnType<typeof createDashboardApi>;

interface Props {
  api: DashboardApi;
}

export function SupportFaqTab(props: Props) {
  const {
    items,
    loading,
    saving,
    message,
    updateItem,
    removeItem,
    addItem,
    save,
  } = useSupportFaq(props.api);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      {/* ── Message ── */}
      {message ? (
        <div
          className={`panel ${message.kind === "error" ? "panel-error" : "panel-info"}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            marginBottom: "var(--space-4)",
          }}
        >
          {message.kind === "error" ? (
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          ) : (
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
          )}
          {message.text}
        </div>
      ) : null}

      {/* ── Loading skeleton ── */}
      {loading && items.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="skeleton" style={{ height: 52, borderRadius: "var(--radius-md)" }} />
          <div className="skeleton" style={{ height: 280, borderRadius: "var(--radius-md)" }} />
        </div>
      ) : null}

      {/* ── FAQ Section ── */}
      {!loading || items.length > 0 ? (
        <section className="panel stacked">
          <SectionHeader
            title="Resposta automática"
            subtitle="Mensagem exibida fora do horário de atendimento"
            trailing={<span className={`badge ${items.length > 0 ? "ok" : "muted"}`}>{items.length}/20 itens</span>}
          />

          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Plus size={20} />
              </div>
              <h3>Nenhuma pergunta cadastrada</h3>
              <p>
                Adicione perguntas frequentes para que o agente responda automaticamente
                no checkout sem acionar o handoff humano.
              </p>
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={addItem}
              >
                <Plus size={14} />
                Adicionar primeira pergunta
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {items.map((item, idx) => (
                  <FaqEditor
                    key={item.id}
                    index={idx}
                    item={item}
                    disabled={saving}
                    onUpdate={(field, val) => updateItem(item.id, field, val)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
              </div>

              {items.length < 20 ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={saving}
                  onClick={addItem}
                  style={{ alignSelf: "flex-start" }}
                >
                  <Plus size={14} />
                  Adicionar pergunta
                </button>
              ) : (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  Limite de 20 perguntas atingido.
                </p>
              )}

              <div style={{ display: "flex", gap: 8, paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                <Button variant="primary" size="sm" arrow disabled={saving || items.length === 0} loading={saving} onClick={() => void save()}>
                  <Save size={14} /> Salvar FAQ
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
